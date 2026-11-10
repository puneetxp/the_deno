// Wire-level pieces of the MySQL/MariaDB client/server protocol: constants,
// and a reader and writer for packet payloads.
// Docs: https://dev.mysql.com/doc/dev/mysql-server/latest/PAGE_PROTOCOL.html
// and https://mariadb.com/kb/en/clientserver-protocol/

// Capability flags (client and server).
export const LONG_PASSWORD = 0x1;
/** affectedRows counts matched rows, as mysql2 has it. */
export const FOUND_ROWS = 0x2;
export const LONG_FLAG = 0x4;
export const CONNECT_WITH_DB = 0x8;
export const PROTOCOL_41 = 0x200;
export const SSL = 0x800;
export const TRANSACTIONS = 0x2000;
export const SECURE_CONNECTION = 0x8000;
export const MULTI_RESULTS = 0x20000;
export const PLUGIN_AUTH = 0x80000;
export const PLUGIN_AUTH_LENENC = 0x200000;

/** Server status bit: another result follows this one. */
export const SERVER_MORE_RESULTS = 0x8;

export const UTF8MB4_UNICODE_CI = 224;
export const BINARY_CHARSET = 63;
/** Largest payload of one packet; longer payloads are split. */
export const MAX_PACKET = 0xffffff;

// Commands.
export const COM_QUIT = 0x01;
export const COM_QUERY = 0x03;

/** Column types. */
export const T = {
  DECIMAL: 0,
  TINY: 1,
  SHORT: 2,
  LONG: 3,
  FLOAT: 4,
  DOUBLE: 5,
  NULL: 6,
  TIMESTAMP: 7,
  LONGLONG: 8,
  INT24: 9,
  DATE: 10,
  TIME: 11,
  DATETIME: 12,
  YEAR: 13,
  NEWDATE: 14,
  BIT: 16,
  JSON: 245,
  NEWDECIMAL: 246,
} as const;

export const enc = new TextEncoder();
export const dec = new TextDecoder();

/** Reads the fields of one packet payload, front to back. */
export class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  u8(): number {
    return this.buf[this.pos++];
  }

  u16(): number {
    const v = this.buf[this.pos] | (this.buf[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }

  u24(): number {
    const v = this.buf[this.pos] | (this.buf[this.pos + 1] << 8) |
      (this.buf[this.pos + 2] << 16);
    this.pos += 3;
    return v;
  }

  u32(): number {
    const v = (this.buf[this.pos] | (this.buf[this.pos + 1] << 8) |
      (this.buf[this.pos + 2] << 16)) + this.buf[this.pos + 3] * 0x1000000;
    this.pos += 4;
    return v;
  }

  /** Length-encoded integer; null for the NULL marker (0xfb). */
  lenenc(): number | null {
    const first = this.u8();
    if (first < 0xfb) return first;
    if (first === 0xfb) return null;
    if (first === 0xfc) return this.u16();
    if (first === 0xfd) return this.u24();
    const lo = this.u32();
    const hi = this.u32();
    return hi * 0x100000000 + lo;
  }

  bytes(n: number): Uint8Array {
    const v = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }

  lenencBytes(): Uint8Array | null {
    const n = this.lenenc();
    return n === null ? null : this.bytes(n);
  }

  lenencStr(): string {
    const b = this.lenencBytes();
    return b === null ? "" : dec.decode(b);
  }

  /** Bytes up to a NUL, which is skipped. */
  nulBytes(): Uint8Array {
    let end = this.buf.indexOf(0, this.pos);
    if (end < 0) end = this.buf.length;
    const v = this.buf.subarray(this.pos, end);
    this.pos = end + 1;
    return v;
  }

  nulStr(): string {
    return dec.decode(this.nulBytes());
  }

  rest(): Uint8Array {
    const v = this.buf.subarray(this.pos);
    this.pos = this.buf.length;
    return v;
  }
}

/** Builds one packet payload. */
export class Writer {
  #parts: number[] = [];
  #chunks: Uint8Array[] = [];

  #flush() {
    if (this.#parts.length) {
      this.#chunks.push(Uint8Array.from(this.#parts));
      this.#parts = [];
    }
  }

  u8(v: number): this {
    this.#parts.push(v & 0xff);
    return this;
  }

  u32(v: number): this {
    return this.u8(v).u8(v >>> 8).u8(v >>> 16).u8(v >>> 24);
  }

  zeros(n: number): this {
    for (let i = 0; i < n; i++) this.#parts.push(0);
    return this;
  }

  bytes(b: Uint8Array): this {
    this.#flush();
    this.#chunks.push(b);
    return this;
  }

  /** A NUL-terminated string. */
  nul(s: string): this {
    return this.bytes(enc.encode(s)).u8(0);
  }

  lenenc(n: number): this {
    if (n < 0xfb) return this.u8(n);
    if (n < 0x10000) return this.u8(0xfc).u8(n).u8(n >>> 8);
    if (n < 0x1000000) return this.u8(0xfd).u8(n).u8(n >>> 8).u8(n >>> 16);
    return this.u8(0xfe).u32(n).u32(Math.floor(n / 0x100000000));
  }

  done(): Uint8Array {
    this.#flush();
    let len = 0;
    for (const c of this.#chunks) len += c.length;
    const out = new Uint8Array(len);
    let off = 0;
    for (const c of this.#chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}
