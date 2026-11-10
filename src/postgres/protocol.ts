// Wire-level pieces of the PostgreSQL frontend/backend protocol (version
// 3.0): message codes, and a reader and writer for message bodies.
// Docs: https://www.postgresql.org/docs/current/protocol-message-formats.html

/** Protocol version 3.0, sent in the startup message. */
export const PROTOCOL_3 = 196608;
/** The code a client sends instead of a version to ask for TLS. */
export const SSL_REQUEST = 80877103;

/** Messages the server sends (the first byte of each). */
export const B = {
  Authentication: 0x52, // R
  BackendKeyData: 0x4b, // K
  BindComplete: 0x32, // 2
  CloseComplete: 0x33, // 3
  CommandComplete: 0x43, // C
  CopyInResponse: 0x47, // G
  CopyOutResponse: 0x48, // H
  DataRow: 0x44, // D
  EmptyQueryResponse: 0x49, // I
  ErrorResponse: 0x45, // E
  NoData: 0x6e, // n
  NoticeResponse: 0x4e, // N
  NotificationResponse: 0x41, // A
  ParameterDescription: 0x74, // t
  ParameterStatus: 0x53, // S
  ParseComplete: 0x31, // 1
  PortalSuspended: 0x73, // s
  ReadyForQuery: 0x5a, // Z
  RowDescription: 0x54, // T
} as const;

/** Messages the client sends. */
export const F = {
  Bind: 0x42, // B
  Close: 0x43, // C
  Describe: 0x44, // D
  Execute: 0x45, // E
  Parse: 0x50, // P
  Password: 0x70, // p (also SASL responses)
  Query: 0x51, // Q
  Sync: 0x53, // S
  Terminate: 0x58, // X
} as const;

export const enc = new TextEncoder();
export const dec = new TextDecoder();

/** Reads the fields of one message body, front to back (big-endian). */
export class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  u8(): number {
    return this.buf[this.pos++];
  }

  i16(): number {
    const v = (this.buf[this.pos] << 8) | this.buf[this.pos + 1];
    this.pos += 2;
    return v > 0x7fff ? v - 0x10000 : v;
  }

  i32(): number {
    const b = this.buf;
    const p = this.pos;
    this.pos += 4;
    return (b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
  }

  bytes(n: number): Uint8Array {
    const v = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }

  /** A NUL-terminated string. */
  cstr(): string {
    let end = this.buf.indexOf(0, this.pos);
    if (end < 0) end = this.buf.length;
    const s = dec.decode(this.buf.subarray(this.pos, end));
    this.pos = end + 1;
    return s;
  }

  rest(): Uint8Array {
    const v = this.buf.subarray(this.pos);
    this.pos = this.buf.length;
    return v;
  }
}

/** Builds messages; several can go into one Writer and one write. */
export class Writer {
  #buf = new Uint8Array(256);
  #len = 0;
  /** Where the current message's length field is, or -1. */
  #lenAt = -1;

  #room(n: number) {
    if (this.#len + n <= this.#buf.length) return;
    let size = this.#buf.length * 2;
    while (size < this.#len + n) size *= 2;
    const bigger = new Uint8Array(size);
    bigger.set(this.#buf.subarray(0, this.#len));
    this.#buf = bigger;
  }

  /** Start a message with this type byte (0 for the untyped startup ones). */
  start(type: number): this {
    this.end();
    if (type) this.u8(type);
    this.#lenAt = this.#len;
    return this.i32(0);
  }

  /** Fill in the length of the current message. */
  end(): this {
    if (this.#lenAt < 0) return this;
    const n = this.#len - this.#lenAt;
    const b = this.#buf;
    const p = this.#lenAt;
    b[p] = n >>> 24;
    b[p + 1] = n >>> 16;
    b[p + 2] = n >>> 8;
    b[p + 3] = n;
    this.#lenAt = -1;
    return this;
  }

  u8(v: number): this {
    this.#room(1);
    this.#buf[this.#len++] = v;
    return this;
  }

  i16(v: number): this {
    this.#room(2);
    this.#buf[this.#len++] = v >>> 8;
    this.#buf[this.#len++] = v;
    return this;
  }

  i32(v: number): this {
    this.#room(4);
    const b = this.#buf;
    b[this.#len++] = v >>> 24;
    b[this.#len++] = v >>> 16;
    b[this.#len++] = v >>> 8;
    b[this.#len++] = v;
    return this;
  }

  bytes(v: Uint8Array): this {
    this.#room(v.length);
    this.#buf.set(v, this.#len);
    this.#len += v.length;
    return this;
  }

  /** A string, NUL-terminated. */
  cstr(s: string): this {
    return this.bytes(enc.encode(s)).u8(0);
  }

  done(): Uint8Array {
    this.end();
    return this.#buf.subarray(0, this.#len);
  }
}
