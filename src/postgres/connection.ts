// One PostgreSQL connection: opens the socket, starts the session, and runs
// statements one at a time. The pieces live in their own files:
//   socket.ts   message I/O and the idle watch
//   startup.ts  TLS, startup message, password exchange (auth.ts)
//   query.ts    simple and extended queries, results
//   values.ts   column values to JS values, and parameters

import {
  connectionLost,
  isServerError,
  PostgresError,
  protocolError,
} from "./errors.ts";
import { F, Writer } from "./protocol.ts";
import { extendedQuery, simpleQuery } from "./query.ts";
import { MessageSocket } from "./socket.ts";
import { type ServerInfo, startup } from "./startup.ts";
import type { ConnectOptions, QueryResult } from "./types.ts";

export class Connection {
  #socket: MessageSocket;
  #lock: Promise<unknown> = Promise.resolve();
  /** ParameterStatus values from the server (server_version, TimeZone, ...). */
  parameters: Record<string, string> = {};
  processId = 0;

  private constructor(socket: MessageSocket) {
    this.#socket = socket;
  }

  /** True once the connection can no longer be used. */
  get closed(): boolean {
    return this.#socket.error !== null;
  }

  /** Connect and start a session, within connectTimeout (default 10 s). */
  static async connect(opts: ConnectOptions): Promise<Connection> {
    const host = opts.host || "localhost";
    const port = opts.port ?? 5432;
    // A host starting with "/" is a socket directory, as in libpq.
    const isUnix = host.startsWith("/");
    const conn = isUnix
      ? await Deno.connect({
        transport: "unix",
        path: `${host}/.s.PGSQL.${port}`,
      })
      : await Deno.connect({ hostname: host, port });
    const socket = new MessageSocket(conn);
    const timer = setTimeout(
      () => socket.fail(new PostgresError("connect timeout", { fatal: true })),
      opts.connectTimeout ?? 10000,
    );
    const c = new Connection(socket);
    try {
      const info: ServerInfo = await startup(socket, opts, isUnix);
      c.parameters = info.parameters;
      c.processId = info.processId;
    } catch (e) {
      // The first error wins: a timeout, or what the server or socket said.
      socket.fail(
        e instanceof PostgresError
          ? e
          : protocolError((e as Error).message ?? String(e)),
      );
      throw socket.error;
    } finally {
      clearTimeout(timer);
    }
    socket.startPump();
    return c;
  }

  /**
   * Run SQL. With parameters ($1, $2, ...) it is one statement; without, the
   * text may hold several, giving one result each. Calls queue up.
   */
  query(sql: string, params?: unknown[]): Promise<QueryResult[]> {
    const run = this.#lock.then(() => this.#query(sql, params));
    this.#lock = run.catch(() => {});
    return run;
  }

  async #query(sql: string, params?: unknown[]): Promise<QueryResult[]> {
    const socket = this.#socket;
    socket.drainIdle(); // notices that arrived since the last query
    if (socket.error) throw socket.error;
    if (socket.hasUnread) {
      socket.fail(
        connectionLost("the server sent data while idle", { unsent: true }),
      );
      throw socket.error;
    }
    socket.busy = true;
    try {
      return params && params.length
        ? await extendedQuery(socket, sql, params)
        : await simpleQuery(socket, sql);
    } catch (e) {
      // A server error leaves the connection usable (it was read up to
      // ReadyForQuery); anything else may have stopped midway.
      if (!isServerError(e)) {
        socket.fail(
          e instanceof PostgresError ? e : protocolError(String(e)),
        );
      }
      throw e;
    } finally {
      socket.busy = false;
    }
  }

  /** Send Terminate and close. */
  async close(): Promise<void> {
    const socket = this.#socket;
    if (!socket.error) {
      try {
        await this.#lock;
        await socket.write(new Writer().start(F.Terminate).done());
      } catch {
        // closing anyway
      }
      socket.fail(new PostgresError("connection closed", { fatal: true }));
    }
    await socket.stopped();
  }
}
