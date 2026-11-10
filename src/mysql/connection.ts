// One MySQL/MariaDB connection over the client/server protocol (text queries).
// Written against the protocol docs: https://dev.mysql.com/doc/dev/mysql-server/latest/PAGE_PROTOCOL.html
// and https://mariadb.com/kb/en/clientserver-protocol/

import {
  cachingSha2Password,
  clearPassword,
  nativePassword,
  rsaEncryptPassword,
} from "./auth.ts";

export type ConnectOptions = {
  host?: string;
  port?: number;
  /** Unix socket path; used instead of host/port when set. */
  socketPath?: string;
  user?: string;
  password?: string;
  database?: string;
  /** TLS for TCP connections: true, or Deno.startTls options. */
  tls?: boolean | { caCerts?: string[]; hostname?: string };
  /** Milliseconds for connect + login (default 10000, as mysql2). */
  connectTimeout?: number;
};

export type Field = {
  db: string;
  table: string;
  orgTable: string;
  name: string;
  orgName: string;
  characterSet: number;
  columnLength: number;
  columnType: number;
  type: number;
  flags: number;
  decimals: number;
};

/** What a statement without rows returns (same fields as mysql2). */
export type ResultSetHeader = {
  fieldCount: 0;
  affectedRows: number;
  insertId: number;
  info: string;
  serverStatus: number;
  warningStatus: number;
  changedRows: number;
};

export type Row = Record<string, unknown>;
type OneResult = { rows: Row[] | ResultSetHeader; fields?: Field[] };

const ERROR_CODES: Record<number, string> = {
  1045: "ER_ACCESS_DENIED_ERROR",
  1048: "ER_BAD_NULL_ERROR",
  1049: "ER_BAD_DB_ERROR",
  1053: "ER_SERVER_SHUTDOWN",
  1054: "ER_BAD_FIELD_ERROR",
  1062: "ER_DUP_ENTRY",
  1064: "ER_PARSE_ERROR",
  1146: "ER_NO_SUCH_TABLE",
  1205: "ER_LOCK_WAIT_TIMEOUT",
  1213: "ER_LOCK_DEADLOCK",
  1264: "ER_WARN_DATA_OUT_OF_RANGE",
  1364: "ER_NO_DEFAULT_FOR_FIELD",
  1366: "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD",
  1406: "ER_DATA_TOO_LONG",
  1451: "ER_ROW_IS_REFERENCED_2",
  1452: "ER_NO_REFERENCED_ROW_2",
  1927: "ER_CONNECTION_KILLED",
  4031: "ER_CLIENT_INTERACTION_TIMEOUT",
};

/** An error from the server (errno/sqlState) or the connection (fatal). */
export class MySQLError extends Error {
  code: string;
  errno?: number;
  sqlState?: string;
  sqlMessage?: string;
  fatal: boolean;
  /** True when the statement was never sent, so it is safe to retry. */
  unsent: boolean;
  constructor(
    message: string,
    opts: {
      errno?: number;
      sqlState?: string;
      fatal?: boolean;
      code?: string;
      unsent?: boolean;
    } = {},
  ) {
    super(message);
    this.unsent = opts.unsent ?? false;
    this.name = "MySQLError";
    this.errno = opts.errno;
    this.sqlState = opts.sqlState;
    this.sqlMessage = opts.errno !== undefined ? message : undefined;
    this.fatal = opts.fatal ?? false;
    this.code = opts.code ??
      (opts.errno !== undefined
        ? ERROR_CODES[opts.errno] ?? `ER_${opts.errno}`
        : "PROTOCOL_ERROR");
  }
}

// Capability flags.
const LONG_PASSWORD = 0x1;
const FOUND_ROWS = 0x2; // affectedRows counts matched rows, as mysql2 does
const LONG_FLAG = 0x4;
const CONNECT_WITH_DB = 0x8;
const PROTOCOL_41 = 0x200;
const SSL = 0x800;
const TRANSACTIONS = 0x2000;
const SECURE_CONNECTION = 0x8000;
const MULTI_RESULTS = 0x20000;
const PLUGIN_AUTH = 0x80000;
const PLUGIN_AUTH_LENENC = 0x200000;

const SERVER_MORE_RESULTS = 0x8;
const UTF8MB4_UNICODE_CI = 224;
const BINARY_CHARSET = 63;
const MAX_PACKET = 0xffffff;

// Column types.
const T = {
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

const enc = new TextEncoder();
const dec = new TextDecoder();

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}
  get done() {
    return this.pos >= this.buf.length;
  }
  u8() {
    return this.buf[this.pos++];
  }
  u16() {
    const v = this.buf[this.pos] | (this.buf[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }
  u24() {
    const v = this.buf[this.pos] | (this.buf[this.pos + 1] << 8) |
      (this.buf[this.pos + 2] << 16);
    this.pos += 3;
    return v;
  }
  u32() {
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
  bytes(n: number) {
    const v = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  lenencBytes(): Uint8Array | null {
    const n = this.lenenc();
    return n === null ? null : this.bytes(n);
  }
  lenencStr() {
    const b = this.lenencBytes();
    return b === null ? "" : dec.decode(b);
  }
  nulBytes() {
    let end = this.buf.indexOf(0, this.pos);
    if (end < 0) end = this.buf.length;
    const v = this.buf.subarray(this.pos, end);
    this.pos = end + 1;
    return v;
  }
  nulStr() {
    return dec.decode(this.nulBytes());
  }
  rest() {
    const v = this.buf.subarray(this.pos);
    this.pos = this.buf.length;
    return v;
  }
}

class Writer {
  #parts: number[] = [];
  #chunks: Uint8Array[] = [];
  #flush() {
    if (this.#parts.length) {
      this.#chunks.push(Uint8Array.from(this.#parts));
      this.#parts = [];
    }
  }
  u8(v: number) {
    this.#parts.push(v & 0xff);
    return this;
  }
  u32(v: number) {
    return this.u8(v).u8(v >>> 8).u8(v >>> 16).u8(v >>> 24);
  }
  zeros(n: number) {
    for (let i = 0; i < n; i++) this.#parts.push(0);
    return this;
  }
  bytes(b: Uint8Array) {
    this.#flush();
    this.#chunks.push(b);
    return this;
  }
  nul(s: string) {
    return this.bytes(enc.encode(s)).u8(0);
  }
  lenenc(n: number) {
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

function serverError(p: Uint8Array): MySQLError {
  const r = new Reader(p);
  r.u8(); // 0xff
  const errno = r.u16();
  let sqlState: string | undefined;
  if (r.buf[r.pos] === 0x23) { // '#'
    r.u8();
    sqlState = dec.decode(r.bytes(5));
  }
  return new MySQLError(dec.decode(r.rest()), { errno, sqlState });
}

function okPacket(p: Uint8Array): ResultSetHeader {
  const r = new Reader(p);
  r.u8(); // 0x00
  const affectedRows = r.lenenc() ?? 0;
  const insertId = r.lenenc() ?? 0;
  const serverStatus = r.done ? 0 : r.u16();
  const warningStatus = r.done ? 0 : r.u16();
  // The info text is length-prefixed on most servers, plain on some.
  let infoBytes = r.done ? new Uint8Array(0) : r.rest();
  if (infoBytes.length && infoBytes[0] === infoBytes.length - 1) {
    infoBytes = infoBytes.subarray(1);
  }
  const info = dec.decode(infoBytes);
  const changed = /\schanged:\s*(\d+)/i.exec(info);
  return {
    fieldCount: 0,
    affectedRows,
    insertId,
    info,
    serverStatus,
    warningStatus,
    changedRows: changed ? Number(changed[1]) : 0,
  };
}

function parseField(p: Uint8Array): Field {
  const r = new Reader(p);
  r.lenencStr(); // catalog
  const db = r.lenencStr();
  const table = r.lenencStr();
  const orgTable = r.lenencStr();
  const name = r.lenencStr();
  const orgName = r.lenencStr();
  r.lenenc(); // length of the fixed fields (0x0c)
  const characterSet = r.u16();
  const columnLength = r.u32();
  const type = r.u8();
  const flags = r.u16();
  const decimals = r.u8();
  return {
    db,
    table,
    orgTable,
    name,
    orgName,
    characterSet,
    columnLength,
    columnType: type,
    type,
    flags,
    decimals,
  };
}

/**
 * Bytes [s, e) as UTF-8 text. Short ASCII is built in JS, which beats a
 * TextDecoder call up to about 16 bytes; everything else uses TextDecoder.
 */
function text(b: Uint8Array, s: number, e: number): string {
  if (e - s <= 16) {
    let out = "";
    for (let i = s; i < e; i++) {
      const c = b[i];
      if (c >= 0x80) return dec.decode(b.subarray(s, e));
      out += String.fromCharCode(c);
    }
    return out;
  }
  return dec.decode(b.subarray(s, e));
}

/** An integer from ASCII digits; past 15 digits, exact as a string if unsafe. */
function int(b: Uint8Array, s: number, e: number): number | string {
  if (e - s > 15) {
    const str = text(b, s, e);
    const n = Number(str);
    return Number.isSafeInteger(n) ? n : str;
  }
  let i = s;
  let neg = false;
  if (b[i] === 0x2d) {
    neg = true;
    i++;
  }
  let n = 0;
  for (; i < e; i++) n = n * 10 + (b[i] - 0x30);
  return neg ? -n : n;
}

function digits(b: Uint8Array, s: number, e: number): number {
  let n = 0;
  for (let i = s; i < e; i++) n = n * 10 + (b[i] - 0x30);
  return n;
}

/**
 * A DATE/DATETIME/TIMESTAMP ('YYYY-MM-DD[ HH:MM:SS[.ffffff]]') as a local-time
 * Date, mysql2's default. Zero dates give an invalid Date (null in JSON).
 */
function date(b: Uint8Array, s: number, e: number): Date {
  if (e - s < 10 || b[s + 4] !== 0x2d || b[s + 7] !== 0x2d) {
    return new Date(NaN);
  }
  const y = digits(b, s, s + 4);
  const mo = digits(b, s + 5, s + 7);
  const d = digits(b, s + 8, s + 10);
  if (y === 0 || mo === 0 || d === 0) return new Date(NaN);
  let h = 0, mi = 0, sec = 0, ms = 0;
  if (e - s >= 19) {
    h = digits(b, s + 11, s + 13);
    mi = digits(b, s + 14, s + 16);
    sec = digits(b, s + 17, s + 19);
    if (e - s > 20) {
      const end = Math.min(e, s + 23);
      ms = digits(b, s + 20, end) *
        (end - s === 21 ? 100 : end - s === 22 ? 10 : 1);
    }
  }
  return localDate(y, mo, d, h, mi, sec, ms);
}

const HOUR = 3600000;
// UTC hour -> local time minus UTC (ms, exact: pre-1900s zones have offsets in
// seconds, which getTimezoneOffset() rounds) for that whole hour, or NaN when
// it changes inside the hour.
const offsets = new Map<number, number>();

function localMinusUTC(t: number): number {
  const x = new Date(t);
  return Date.UTC(
    x.getFullYear(),
    x.getMonth(),
    x.getDate(),
    x.getHours(),
    x.getMinutes(),
    x.getSeconds(),
    x.getMilliseconds(),
  ) - t;
}

function hourOffset(hour: number): number {
  let o = offsets.get(hour);
  if (o === undefined) {
    const a = localMinusUTC(hour * HOUR);
    const b = localMinusUTC(hour * HOUR + HOUR - 1);
    o = a === b ? a : NaN;
    if (offsets.size > 50000) offsets.clear();
    offsets.set(hour, o);
  }
  return o;
}

/**
 * The same instant as `new Date(y, mo - 1, d, h, mi, sec, ms)`, which is slow
 * because it resolves the time zone each call. When the offset is the same
 * from 15 hours before to 15 hours after (no DST change near; zones are at
 * most 14 hours from UTC), the wall time minus that offset is exact.
 * Otherwise the Date constructor decides.
 */
export function localDate(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  sec: number,
  ms: number,
): Date {
  if (y < 100) {
    // The constructor maps years 0-99 to 1900-1999; 400 years later has the
    // same calendar (and, that far back, no DST).
    const old = new Date(y + 400, mo - 1, d, h, mi, sec, ms);
    old.setFullYear(y);
    return old;
  }
  const wall = Date.UTC(y, mo - 1, d, h, mi, sec, ms);
  const before = hourOffset(Math.floor(wall / HOUR) - 15);
  if (before === hourOffset(Math.floor(wall / HOUR) + 15)) {
    return new Date(wall - before);
  }
  return new Date(y, mo - 1, d, h, mi, sec, ms);
}

type Cast = (b: Uint8Array, s: number, e: number) => unknown;

const castFloat: Cast = (b, s, e) => Number(text(b, s, e));
const castBytes: Cast = (b, s, e) => b.slice(s, e);
const castJSON: Cast = (b, s, e) => {
  const str = text(b, s, e);
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
};

/** How to turn a column's text value into a JS value (mysql2's defaults). */
function caster(f: Field): Cast {
  switch (f.type) {
    case T.TINY:
    case T.SHORT:
    case T.LONG:
    case T.INT24:
    case T.YEAR:
    case T.LONGLONG: // ids as numbers; past 2^53 an exact string
      return int;
    case T.FLOAT:
    case T.DOUBLE:
      return castFloat;
    case T.DECIMAL:
    case T.NEWDECIMAL:
    case T.TIME:
      return text;
    case T.DATE:
    case T.NEWDATE:
    case T.DATETIME:
    case T.TIMESTAMP:
      return date;
    case T.JSON:
      return castJSON;
    case T.BIT:
      return castBytes;
    default:
      return f.characterSet === BINARY_CHARSET ? castBytes : text;
  }
}

export class Connection {
  #conn: Deno.Conn;
  #buf = new Uint8Array(65536);
  #start = 0;
  #end = 0;
  #seq = 0;
  #secure: boolean;
  #pump: Promise<void> | null = null;
  #wake: (() => void) | null = null;
  #error: MySQLError | null = null;
  #busy = false;
  #lock: Promise<unknown> = Promise.resolve();
  threadId = 0;
  serverVersion = "";

  private constructor(conn: Deno.Conn, secure: boolean) {
    this.#conn = conn;
    this.#secure = secure;
  }

  /** True once the connection can no longer be used. */
  get closed(): boolean {
    return this.#error !== null;
  }

  static async connect(opts: ConnectOptions): Promise<Connection> {
    const timeoutMs = opts.connectTimeout ?? 10000;
    const raw = opts.socketPath
      ? await Deno.connect({ transport: "unix", path: opts.socketPath })
      : await Deno.connect({
        hostname: opts.host || "localhost",
        port: opts.port ?? 3306,
      });
    const c = new Connection(raw, !!opts.socketPath);
    const timer = setTimeout(
      () =>
        c.#fail(
          new MySQLError("connect timeout", { fatal: true, code: "ETIMEDOUT" }),
        ),
      timeoutMs,
    );
    try {
      await c.#handshake(opts);
    } catch (e) {
      // The first error wins: a timeout, or what the server or socket said.
      c.#fail(
        e instanceof MySQLError
          ? e
          : new MySQLError(String(e), { fatal: true }),
      );
      throw c.#error;
    } finally {
      clearTimeout(timer);
    }
    c.#pump = c.#runPump();
    return c;
  }

  // ---- reading -----------------------------------------------------------

  #fail(err: MySQLError) {
    if (this.#error) return;
    this.#error = err;
    try {
      this.#conn.close();
    } catch {
      // already closed
    }
    this.#wake?.();
  }

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
      this.#fail(
        new MySQLError(`connection lost: ${(e as Error).message}`, {
          fatal: true,
          code: "PROTOCOL_CONNECTION_LOST",
        }),
      );
      return false;
    }
    if (n === null) {
      this.#fail(
        new MySQLError("connection lost: the server closed the connection", {
          fatal: true,
          code: "PROTOCOL_CONNECTION_LOST",
        }),
      );
      return false;
    }
    this.#end += n;
    return true;
  }

  // After login one read is always pending, so a server that closes an idle
  // connection (wait_timeout, restart) marks it closed before the pool reuses it.
  async #runPump() {
    while (!this.#error) {
      if (!(await this.#readOnce())) break;
      // A running query may already have read these bytes (it reads whatever
      // is buffered), so only bytes still unread while idle are unexpected.
      if (!this.#busy && this.#end > this.#start) {
        this.#fail(
          new MySQLError("connection lost: the server sent data while idle", {
            fatal: true,
            code: "PROTOCOL_CONNECTION_LOST",
          }),
        );
        break;
      }
      this.#wake?.();
    }
    this.#wake?.();
  }

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
   * null. It is a view into the read buffer: use it before the next read.
   */
  #bufferedPacket(): Uint8Array | null {
    const b = this.#buf;
    const s = this.#start;
    if (this.#end - s < 4) return null;
    const len = b[s] | (b[s + 1] << 8) | (b[s + 2] << 16);
    if (len >= MAX_PACKET || this.#end - s < 4 + len) return null;
    this.#seq = (b[s + 3] + 1) & 0xff;
    this.#start = s + 4 + len;
    return b.subarray(s + 4, s + 4 + len);
  }

  async #readPacket(): Promise<Uint8Array> {
    const ready = this.#bufferedPacket();
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
      this.#fail(
        new MySQLError(`connection lost: ${(e as Error).message}`, {
          fatal: true,
          code: "PROTOCOL_CONNECTION_LOST",
        }),
      );
      throw this.#error;
    }
  }

  async #writePacket(payload: Uint8Array) {
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

  // ---- login -------------------------------------------------------------

  async #handshake(opts: ConnectOptions) {
    const p = await this.#readPacket();
    if (p[0] === 0xff) throw serverError(p);
    const r = new Reader(p);
    if (r.u8() !== 10) {
      throw new MySQLError("unsupported handshake protocol", { fatal: true });
    }
    this.serverVersion = r.nulStr();
    this.threadId = r.u32();
    const part1 = r.bytes(8);
    r.u8(); // filler
    let serverCaps = r.u16();
    let part2 = new Uint8Array(0);
    let plugin = "mysql_native_password";
    if (!r.done) {
      r.u8(); // charset
      r.u16(); // status
      serverCaps |= r.u16() << 16;
      const authLen = r.u8();
      r.bytes(10); // reserved (MariaDB extended caps)
      if (serverCaps & SECURE_CONNECTION) {
        part2 = r.bytes(Math.max(13, authLen - 8)).slice();
      }
      if (serverCaps & PLUGIN_AUTH) plugin = r.nulStr();
    }
    let scramble = new Uint8Array(part1.length + part2.length);
    scramble.set(part1);
    scramble.set(part2, part1.length);
    if (scramble[scramble.length - 1] === 0) {
      scramble = scramble.subarray(0, scramble.length - 1);
    }

    if (!(serverCaps & PROTOCOL_41)) {
      throw new MySQLError("server is too old (no protocol 4.1)", {
        fatal: true,
      });
    }
    let caps = LONG_PASSWORD | FOUND_ROWS | LONG_FLAG | PROTOCOL_41 |
      TRANSACTIONS | SECURE_CONNECTION | MULTI_RESULTS | PLUGIN_AUTH |
      PLUGIN_AUTH_LENENC;
    if (opts.database) caps |= CONNECT_WITH_DB;
    caps &= serverCaps | CONNECT_WITH_DB;

    const prefix = () =>
      new Writer().u32(caps).u32(MAX_PACKET).u8(UTF8MB4_UNICODE_CI).zeros(23);

    if (opts.tls && !opts.socketPath) {
      if (!(serverCaps & SSL)) {
        throw new MySQLError("the server does not support TLS", {
          fatal: true,
        });
      }
      caps |= SSL;
      await this.#writePacket(prefix().done());
      const tlsOpts = typeof opts.tls === "object" ? opts.tls : {};
      this.#conn = await Deno.startTls(this.#conn as Deno.TcpConn, {
        hostname: tlsOpts.hostname ?? opts.host ?? "localhost",
        caCerts: tlsOpts.caCerts,
      });
      this.#secure = true;
    }

    const password = opts.password ?? "";
    let authData = await this.#authResponse(plugin, password, scramble);
    const w = prefix().nul(opts.user ?? "");
    if (caps & PLUGIN_AUTH_LENENC) w.lenenc(authData.length).bytes(authData);
    else w.u8(authData.length).bytes(authData);
    if (caps & CONNECT_WITH_DB) w.nul(opts.database!);
    if (caps & PLUGIN_AUTH) w.nul(plugin);
    await this.#writePacket(w.done());

    while (true) {
      const p = await this.#readPacket();
      if (p[0] === 0x00) return;
      if (p[0] === 0xff) throw serverError(p);
      if (p[0] === 0xfe) {
        // Auth switch: the server wants another plugin.
        const sr = new Reader(p);
        sr.u8();
        if (sr.done) {
          throw new MySQLError(
            "the server asked for the old (pre-4.1) password scheme, which is not supported",
            { fatal: true },
          );
        }
        plugin = sr.nulStr();
        scramble = sr.rest().slice();
        if (scramble[scramble.length - 1] === 0) {
          scramble = scramble.subarray(0, scramble.length - 1);
        }
        authData = await this.#authResponse(plugin, password, scramble);
        await this.#writePacket(authData);
        continue;
      }
      if (p[0] === 0x01) {
        // More data for the current plugin.
        const data = p.subarray(1);
        if (plugin === "caching_sha2_password" && data.length === 1) {
          if (data[0] === 3) continue; // fast login done; OK follows
          if (data[0] === 4) {
            if (this.#secure) await this.#writePacket(clearPassword(password));
            else await this.#writePacket(Uint8Array.of(2)); // ask for the RSA key
            continue;
          }
        }
        if (
          plugin === "caching_sha2_password" || plugin === "sha256_password"
        ) {
          const pem = dec.decode(data);
          await this.#writePacket(
            await rsaEncryptPassword(password, scramble, pem),
          );
          continue;
        }
      }
      throw new MySQLError(
        `unexpected packet during login (plugin ${plugin})`,
        { fatal: true },
      );
    }
  }

  async #authResponse(plugin: string, password: string, scramble: Uint8Array) {
    switch (plugin) {
      case "mysql_native_password":
        return await nativePassword(password, scramble);
      case "caching_sha2_password":
        return await cachingSha2Password(password, scramble);
      case "sha256_password":
        if (!password) return Uint8Array.of(0);
        return this.#secure ? clearPassword(password) : Uint8Array.of(1);
      case "mysql_clear_password":
        if (!this.#secure) {
          throw new MySQLError(
            "the server asked for the clear-text password over an unencrypted connection; use TLS or a socket",
            { fatal: true },
          );
        }
        return clearPassword(password);
      default:
        throw new MySQLError(`unsupported login plugin: ${plugin}`, {
          fatal: true,
        });
    }
  }

  // ---- queries -----------------------------------------------------------

  /**
   * Run SQL (already formatted) with COM_QUERY. Returns mysql2's shapes:
   * [rows, fields] for a SELECT, [ResultSetHeader, undefined] otherwise, and
   * arrays of each when a statement (CALL) gives several results.
   */
  query(sql: string): Promise<[unknown, unknown]> {
    const run = this.#lock.then(() => this.#query(sql));
    this.#lock = run.catch(() => {});
    return run;
  }

  async #query(sql: string): Promise<[unknown, unknown]> {
    if (this.#error) throw this.#error;
    if (this.#end > this.#start) {
      // Bytes nobody asked for (e.g. a timeout notice before a close): this
      // connection is out of step, and nothing has been sent on it yet.
      this.#fail(
        new MySQLError("connection lost: the server sent data while idle", {
          fatal: true,
          code: "PROTOCOL_CONNECTION_LOST",
          unsent: true,
        }),
      );
      throw this.#error;
    }
    this.#busy = true;
    try {
      this.#seq = 0;
      const body = enc.encode(sql);
      const payload = new Uint8Array(body.length + 1);
      payload[0] = 0x03;
      payload.set(body, 1);
      await this.#writePacket(payload);

      const results: OneResult[] = [];
      while (true) {
        const p = await this.#readPacket();
        if (p[0] === 0x00) {
          const ok = okPacket(p);
          results.push({ rows: ok });
          if (ok.serverStatus & SERVER_MORE_RESULTS) continue;
          break;
        }
        if (p[0] === 0xff) throw serverError(p);
        if (p[0] === 0xfb) {
          // LOCAL INFILE is not enabled; refuse it.
          await this.#writePacket(new Uint8Array(0));
          continue;
        }
        const count = new Reader(p).lenenc() ?? 0;
        const fields: Field[] = [];
        for (let i = 0; i < count; i++) {
          fields.push(parseField(await this.#readPacket()));
        }
        await this.#readPacket(); // EOF after the column definitions
        const names = fields.map((f) => f.name);
        const casts = fields.map(caster);
        const rows: Row[] = [];
        let status = 0;
        while (true) {
          // Rows already in the buffer are parsed without an await each.
          const rp = this.#bufferedPacket() ?? await this.#readPacket();
          if (rp[0] === 0xfe && rp.length < 9) {
            status = rp[3] | (rp[4] << 8);
            break;
          }
          if (rp[0] === 0xff) throw serverError(rp);
          const row: Row = {};
          let pos = 0;
          for (let i = 0; i < names.length; i++) {
            let len = rp[pos++];
            if (len === 0xfb) {
              row[names[i]] = null;
              continue;
            }
            if (len === 0xfc) {
              len = rp[pos] | (rp[pos + 1] << 8);
              pos += 2;
            } else if (len === 0xfd) {
              len = rp[pos] | (rp[pos + 1] << 8) | (rp[pos + 2] << 16);
              pos += 3;
            } else if (len === 0xfe) {
              len = (rp[pos] | (rp[pos + 1] << 8) | (rp[pos + 2] << 16)) +
                rp[pos + 3] * 0x1000000 +
                (rp[pos + 4] + rp[pos + 5] * 0x100 + rp[pos + 6] * 0x10000 +
                    rp[pos + 7] * 0x1000000) * 0x100000000;
              pos += 8;
            }
            row[names[i]] = casts[i](rp, pos, pos + len);
            pos += len;
          }
          rows.push(row);
        }
        results.push({ rows, fields });
        if (!(status & SERVER_MORE_RESULTS)) break;
      }
      if (results.length === 1) return [results[0].rows, results[0].fields];
      return [results.map((x) => x.rows), results.map((x) => x.fields)];
    } catch (e) {
      // A server error leaves the connection usable; anything else may have
      // stopped mid-result, so the connection is dropped.
      if (!(e instanceof MySQLError && e.errno !== undefined)) {
        this.#fail(
          e instanceof MySQLError
            ? e
            : new MySQLError(String(e), { fatal: true }),
        );
      }
      throw e;
    } finally {
      this.#busy = false;
    }
  }

  /** Send COM_QUIT and close. */
  async close(): Promise<void> {
    if (!this.#error) {
      try {
        await this.#lock;
        this.#seq = 0;
        await this.#writePacket(Uint8Array.of(0x01));
      } catch {
        // closing anyway
      }
      this.#fail(
        new MySQLError("connection closed", {
          fatal: true,
          code: "PROTOCOL_ENQUEUE_AFTER_QUIT",
        }),
      );
    }
    await this.#pump;
  }
}
