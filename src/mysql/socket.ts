// Packet I/O over one TCP/TLS/Unix connection: a read buffer, packet framing
// (3-byte length + sequence number), and a background read that notices when
// the server closes an idle connection.

import { connectionLost, type MySQLError } from "./errors.ts";
import { MAX_PACKET } from "./protocol.ts";

export class PacketSocket {
  #conn: Deno.Conn;
  #buf = new Uint8Array(65536);
  /** Unread bytes are #buf[#start, #end). */
  #start = 0;
  #end = 0;
  #seq = 0;
  #pump: Promise<void> | null = null;
  #wake: (() => void) | null = null;
  #error: MySQLError | null = null;
  /** TLS or a local socket: safe for a clear-text password. */
  secure: boolean;
  /** Set while a command runs; data arriving otherwise is unexpected. */
  busy = false;

  constructor(conn: Deno.Conn, secure: boolean) {
    this.#conn = conn;
    this.secure = secure;
  }

  /** Why the socket can no longer be used, or null while it can. */
  get error(): MySQLError | null {
    return this.#error;
  }

  /** True when bytes are waiting that no command has read. */
  get hasUnread(): boolean {
    return this.#end > this.#start;
  }

  /** Close the socket for good; the first error given is kept. */
  fail(err: MySQLError): void {
    if (this.#error) return;
    this.#error = err;
    try {
      this.#conn.close();
    } catch {
      // already closed
    }
    this.#wake?.();
  }

  /** Start numbering packets at 0, as every command does. */
  resetSequence(): void {
    this.#seq = 0;
  }

  /** Upgrade to TLS (during login, before any read is pending). */
  async startTls(hostname: string, caCerts?: string[]): Promise<void> {
    this.#conn = await Deno.startTls(this.#conn as Deno.TcpConn, {
      hostname,
      caCerts,
    });
    this.secure = true;
  }

  /**
   * After login, keep one read pending at all times, so a server that closes
   * an idle connection (wait_timeout, restart) marks it closed before reuse.
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
      n = await this.#conn.read(this.#buf.subarray(this.#end));
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
      // A running command may already have read these bytes (it reads
      // whatever is buffered), so only bytes still unread while idle count.
      if (!this.busy && this.hasUnread) {
        this.fail(connectionLost("the server sent data while idle"));
        break;
      }
      this.#wake?.();
    }
    this.#wake?.();
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

  /**
   * The next packet if it is already buffered whole (and under 16MB), else
   * null. No await, so rows already received are parsed back to back. It is
   * a view into the read buffer: use it before the next read.
   */
  bufferedPacket(): Uint8Array | null {
    const b = this.#buf;
    const s = this.#start;
    if (this.#end - s < 4) return null;
    const len = b[s] | (b[s + 1] << 8) | (b[s + 2] << 16);
    if (len >= MAX_PACKET || this.#end - s < 4 + len) return null;
    this.#seq = (b[s + 3] + 1) & 0xff;
    this.#start = s + 4 + len;
    return b.subarray(s + 4, s + 4 + len);
  }

  /** The next packet's payload (a copy), joining 16MB pieces. */
  async readPacket(): Promise<Uint8Array> {
    const ready = this.bufferedPacket();
    if (ready) return ready.slice();
    let payload: Uint8Array | null = null;
    while (true) {
      await this.#need(4);
      const b = this.#buf;
      const s = this.#start;
      const len = b[s] | (b[s + 1] << 8) | (b[s + 2] << 16);
      this.#seq = (b[s + 3] + 1) & 0xff;
      await this.#need(4 + len);
      const part = this.#buf.slice(this.#start + 4, this.#start + 4 + len);
      this.#start += 4 + len;
      if (payload) {
        const joined: Uint8Array = new Uint8Array(payload.length + part.length);
        joined.set(payload);
        joined.set(part, payload.length);
        payload = joined;
      } else {
        payload = part;
      }
      if (len < MAX_PACKET) return payload;
    }
  }

  // ---- writing -----------------------------------------------------------

  async #writeAll(b: Uint8Array) {
    let off = 0;
    try {
      while (off < b.length) off += await this.#conn.write(b.subarray(off));
    } catch (e) {
      this.fail(connectionLost((e as Error).message));
      throw this.#error;
    }
  }

  /** Send a payload as one packet, or 16MB pieces if longer. */
  async writePacket(payload: Uint8Array): Promise<void> {
    if (this.#error) throw this.#error;
    let off = 0;
    while (true) {
      const len = Math.min(MAX_PACKET, payload.length - off);
      const out = new Uint8Array(4 + len);
      out[0] = len & 0xff;
      out[1] = (len >>> 8) & 0xff;
      out[2] = (len >>> 16) & 0xff;
      out[3] = this.#seq;
      this.#seq = (this.#seq + 1) & 0xff;
      out.set(payload.subarray(off, off + len), 4);
      await this.#writeAll(out);
      off += len;
      // A payload of exactly n * 16MB ends with an empty packet.
      if (len < MAX_PACKET) return;
    }
  }
}
