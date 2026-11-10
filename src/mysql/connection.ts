// One MySQL/MariaDB connection: opens the socket, logs in, and runs text
// queries one at a time. The pieces live in their own files:
//   socket.ts   packet I/O and the idle watch
//   login.ts    greeting, TLS and auth plugins
//   results.ts  reading query results
//   values.ts   column values to JS values

import {
  connectionLost,
  isServerError,
  MySQLError,
  protocolError,
} from "./errors.ts";
import { login } from "./login.ts";
import { COM_QUERY, COM_QUIT, enc } from "./protocol.ts";
import { readResults } from "./results.ts";
import { PacketSocket } from "./socket.ts";
import type { ConnectOptions } from "./types.ts";

export class Connection {
  #socket: PacketSocket;
  #lock: Promise<unknown> = Promise.resolve();
  threadId = 0;
  serverVersion = "";

  private constructor(socket: PacketSocket) {
    this.#socket = socket;
  }

  /** True once the connection can no longer be used. */
  get closed(): boolean {
    return this.#socket.error !== null;
  }

  /** Connect and log in, within connectTimeout (default 10 s). */
  static async connect(opts: ConnectOptions): Promise<Connection> {
    const conn = opts.socketPath
      ? await Deno.connect({ transport: "unix", path: opts.socketPath })
      : await Deno.connect({
        hostname: opts.host || "localhost",
        port: opts.port ?? 3306,
      });
    const socket = new PacketSocket(conn, !!opts.socketPath);
    const timer = setTimeout(
      () =>
        socket.fail(
          new MySQLError("connect timeout", { fatal: true, code: "ETIMEDOUT" }),
        ),
      opts.connectTimeout ?? 10000,
    );
    const c = new Connection(socket);
    try {
      const info = await login(socket, opts);
      c.threadId = info.threadId;
      c.serverVersion = info.serverVersion;
    } catch (e) {
      // The first error wins: a timeout, or what the server or socket said.
      socket.fail(e instanceof MySQLError ? e : protocolError(String(e)));
      throw socket.error;
    } finally {
      clearTimeout(timer);
    }
    socket.startPump();
    return c;
  }

  /**
   * Run SQL (already formatted, see format.ts) with COM_QUERY. Calls queue
   * up; one runs at a time. Results have mysql2's shapes (results.ts).
   */
  query(sql: string): Promise<[unknown, unknown]> {
    const run = this.#lock.then(() => this.#query(sql));
    this.#lock = run.catch(() => {});
    return run;
  }

  async #query(sql: string): Promise<[unknown, unknown]> {
    const socket = this.#socket;
    if (socket.error) throw socket.error;
    if (socket.hasUnread) {
      // Bytes nobody asked for (e.g. a timeout notice before a close): the
      // connection is out of step, and nothing has been sent on it yet.
      socket.fail(
        connectionLost("the server sent data while idle", { unsent: true }),
      );
      throw socket.error;
    }
    socket.busy = true;
    try {
      socket.resetSequence();
      const body = enc.encode(sql);
      const payload = new Uint8Array(body.length + 1);
      payload[0] = COM_QUERY;
      payload.set(body, 1);
      await socket.writePacket(payload);
      return await readResults(socket);
    } catch (e) {
      // A server error leaves the connection usable; anything else may have
      // stopped mid-result, so the connection is dropped.
      if (!isServerError(e)) {
        socket.fail(e instanceof MySQLError ? e : protocolError(String(e)));
      }
      throw e;
    } finally {
      socket.busy = false;
    }
  }

  /** Send COM_QUIT and close. */
  async close(): Promise<void> {
    const socket = this.#socket;
    if (!socket.error) {
      try {
        await this.#lock;
        socket.resetSequence();
        await socket.writePacket(Uint8Array.of(COM_QUIT));
      } catch {
        // closing anyway
      }
      socket.fail(
        new MySQLError("connection closed", {
          fatal: true,
          code: "PROTOCOL_ENQUEUE_AFTER_QUIT",
        }),
      );
    }
    await socket.stopped();
  }
}
