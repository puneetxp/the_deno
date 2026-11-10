// Message I/O over one TCP/TLS/Unix connection: a read buffer, message
// framing (type byte + 4-byte length), and a background read that notices
// when the server closes an idle connection.

import {
  connectionLost,
  type PostgresError,
  protocolError,
  serverError,
} from "./errors.ts";
import { B } from "./protocol.ts";

export class MessageSocket {
  #conn: Deno.Conn;
  #buf = new Uint8Array(65536);
  /** Unread bytes are #buf[#start, #end). */
  #start = 0;
  #end = 0;
  #pump: Promise<void> | null = null;
  #wake: (() => void) | null = null;
  #error: PostgresError | null = null;
  // Resolved by fail(). In Deno, close() with a read pending neither wakes the
  // read nor frees the socket until the read ends, so reads also wait on this.
  #abort!: (v: null) => void;
  #aborted = new Promise<null>((r) => (this.#abort = r));
  /** The type byte of the message last returned. */
  type = 0;
  /** Set while a command runs; data arriving otherwise is checked. */
  busy = false;

  constructor(conn: Deno.Conn) {
    this.#conn = conn;
  }

  /** Why the socket can no longer be used, or null while it can. */
  get error(): PostgresError | null {
    return this.#error;
  }

  /** True when bytes are waiting that no command has read. */
  get hasUnread(): boolean {
    return this.#end > this.#start;
  }

  /** Close the socket for good; the first error given is kept. */
  fail(err: PostgresError): void {
    if (this.#error) return;
    this.#error = err;
    // Shut down our side first: the server sees the end of the stream and
    // closes, which ends the pending read, and then the socket is closed.
    // unref() keeps a server that never answers from holding the process.
    const conn = this.#conn;
    const close = () => {
      try {
        conn.close();
      } catch {
        // already closed
      }
    };
    try {
      conn.unref();
      conn.closeWrite().then(close, close);
    } catch {
      close();
    }
    this.#abort(null);
    this.#wake?.();
  }

  /** Upgrade to TLS (during startup, before any read is pending). */
  async startTls(hostname: string, caCerts?: string[]): Promise<void> {
    this.#conn = await Deno.startTls(this.#conn as Deno.TcpConn, {
      hostname,
      caCerts,
    });
  }

  /**
   * After startup, keep one read pending at all times, so a server that
   * closes an idle connection marks it closed before the pool reuses it.
   */
  startPump(): void {
    this.#pump ??= this.#runPump();
  }

  /** Wait until the background read has stopped (after fail()). */
  async stopped(): Promise<void> {
    await this.#pump;
  }

  // ---- reading -----------------------------------------------------------

  // The only place that moves data in the buffer, and it runs before the read
  // is issued, so a pending read never has its target moved under it.
  async #readOnce(): Promise<boolean> {
    if (this.#start === this.#end) this.#start = this.#end = 0;
    if (this.#end === this.#buf.length) {
      if (this.#start > 0) {
        this.#buf.copyWithin(0, this.#start, this.#end);
        this.#end -= this.#start;
        this.#start = 0;
      } else {
        const bigger = new Uint8Array(this.#buf.length * 2);
        bigger.set(this.#buf.subarray(0, this.#end));
        this.#buf = bigger;
      }
    }
    let n: number | null;
    try {
      n = await Promise.race([
        this.#conn.read(this.#buf.subarray(this.#end)),
        this.#aborted,
      ]);
      if (this.#error) return false;
    } catch (e) {
      this.fail(connectionLost((e as Error).message));
      return false;
    }
    if (n === null) {
      this.fail(connectionLost("the server closed the connection"));
      return false;
    }
    this.#end += n;
    return true;
  }

  async #runPump() {
    while (!this.#error) {
      if (!(await this.#readOnce())) break;
      if (!this.busy) this.drainIdle();
      this.#wake?.();
    }
    this.#wake?.();
  }

  /**
   * While idle the server may send notices, parameter changes and
   * notifications, which are dropped. An error (e.g. "terminating connection
   * due to idle-session timeout") or anything else ends the connection.
   */
  drainIdle(): void {
    let m: Uint8Array | null;
    while ((m = this.bufferedMessage())) {
      const t = this.type;
      if (
        t === B.NoticeResponse || t === B.ParameterStatus ||
        t === B.NotificationResponse
      ) continue;
      const err = t === B.ErrorResponse
        ? serverError(m)
        : protocolError("the server sent data while idle");
      err.fatal = true;
      this.fail(err);
      return;
    }
  }

  /** Wait until n unread bytes are buffered. */
  async #need(n: number) {
    while (this.#end - this.#start < n) {
      if (this.#error) throw this.#error;
      if (this.#pump) {
        await new Promise<void>((r) => (this.#wake = r));
        this.#wake = null;
      } else if (!(await this.#readOnce())) {
        throw this.#error;
      }
    }
  }

  /** One byte (the answer to an SSLRequest). */
  async readByte(): Promise<number> {
    await this.#need(1);
    return this.#buf[this.#start++];
  }

  /**
   * The next message if it is already buffered whole, else null; its type is
   * in `type`. No await, so rows already received are parsed back to back.
   * It is a view into the read buffer: use it before the next read.
   */
  bufferedMessage(): Uint8Array | null {
    const b = this.#buf;
    const s = this.#start;
    if (this.#end - s < 5) return null;
    const len = ((b[s + 1] << 24) | (b[s + 2] << 16) | (b[s + 3] << 8) |
      b[s + 4]) >>> 0;
    if (this.#end - s < 1 + len) return null;
    this.type = b[s];
    this.#start = s + 1 + len;
    return b.subarray(s + 5, s + 1 + len);
  }

  /** The next message's body (a copy); its type is in `type`. */
  async readMessage(): Promise<Uint8Array> {
    const ready = this.bufferedMessage();
    if (ready) return ready.slice();
    await this.#need(5);
    const b = this.#buf;
    const s = this.#start;
    const len = ((b[s + 1] << 24) | (b[s + 2] << 16) | (b[s + 3] << 8) |
      b[s + 4]) >>> 0;
    if (len < 4) throw protocolError("bad message length");
    await this.#need(1 + len);
    this.type = this.#buf[this.#start];
    const body = this.#buf.slice(this.#start + 5, this.#start + 1 + len);
    this.#start += 1 + len;
    return body;
  }

  // ---- writing -----------------------------------------------------------

  /** Send bytes (one or more whole messages). */
  async write(b: Uint8Array): Promise<void> {
    if (this.#error) throw this.#error;
    let off = 0;
    try {
      while (off < b.length) off += await this.#conn.write(b.subarray(off));
    } catch (e) {
      this.fail(connectionLost((e as Error).message));
      throw this.#error;
    }
  }
}
