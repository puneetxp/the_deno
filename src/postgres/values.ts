// Values in the text format: decoding result columns by type OID, as npm:pg
// (pg-types) does by default, and encoding query parameters as pg does.
// Decoders run once per value on bytes [s, e) of a DataRow, without copying.

import { localDate } from "../local_date.ts";
import { dec } from "./protocol.ts";

/** Turns bytes [s, e) of a DataRow into one JS value. */
export type Decode = (b: Uint8Array, s: number, e: number) => unknown;

// Type OIDs (pg_type.oid) with a decoder other than plain text.
export const OID = {
  bool: 16,
  bytea: 17,
  int8: 20,
  int2: 21,
  int4: 23,
  oid: 26,
  json: 114,
  point: 600,
  float4: 700,
  float8: 701,
  circle: 718,
  date: 1082,
  timestamp: 1114,
  timestamptz: 1184,
  interval: 1186,
  jsonb: 3802,
} as const;

/**
 * Bytes [s, e) as UTF-8 text. Short ASCII is built in JS, which beats a
 * TextDecoder call up to about 16 bytes; everything else uses TextDecoder.
 */
export function text(b: Uint8Array, s: number, e: number): string {
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

/** int2/int4/oid. */
function int(b: Uint8Array, s: number, e: number): number {
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

/** int8: a number when exact, else the digits as a string. */
function int8(b: Uint8Array, s: number, e: number): number | string {
  if (e - s <= 15) return int(b, s, e);
  const str = text(b, s, e);
  const n = Number(str);
  return Number.isSafeInteger(n) ? n : str;
}

const float: Decode = (b, s, e) => parseFloat(text(b, s, e));
const bool: Decode = (b, s) => b[s] === 0x74; // 't'
const json: Decode = (b, s, e) => JSON.parse(text(b, s, e));

/** bytea: hex ("\x00ff") or the old escape format. */
function bytea(b: Uint8Array, s: number, e: number): Uint8Array {
  if (b[s] === 0x5c && b[s + 1] === 0x78) { // \x
    const out = new Uint8Array((e - s - 2) >> 1);
    for (let i = 0, p = s + 2; i < out.length; i++, p += 2) {
      out[i] = parseInt(String.fromCharCode(b[p], b[p + 1]), 16);
    }
    return out;
  }
  const out: number[] = [];
  for (let p = s; p < e; p++) {
    if (b[p] !== 0x5c) out.push(b[p]);
    else if (b[p + 1] === 0x5c) out.push(0x5c), p++;
    else {
      out.push(parseInt(String.fromCharCode(b[p + 1], b[p + 2], b[p + 3]), 8));
      p += 3;
    }
  }
  return Uint8Array.from(out);
}

// ---- dates -------------------------------------------------------------

const DATETIME =
  /^(\d{1,})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?)?(?:([+-])(\d{2})(?::?(\d{2}))?(?::(\d{2}))?)?( BC)?$/;

/**
 * date/timestamp/timestamptz text: local-time Dates, except that a value
 * with a UTC offset (timestamptz) is that exact instant. infinity and
 * -infinity become Infinity and -Infinity, as pg-types does.
 */
function dateTime(s: string): Date | number {
  if (s === "infinity") return Infinity;
  if (s === "-infinity") return -Infinity;
  const m = DATETIME.exec(s);
  if (!m) return new Date(NaN);
  let y = Number(m[1]);
  if (m[12]) y = 1 - y; // 1 BC is year 0
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = m[4] ? Number(m[4]) : 0;
  const mi = m[5] ? Number(m[5]) : 0;
  const sec = m[6] ? Number(m[6]) : 0;
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
  if (!m[8]) return localDate(y, mo, d, h, mi, sec, ms);
  const sign = m[8] === "-" ? -1 : 1;
  const offset = sign *
    (Number(m[9]) * 3600 + Number(m[10] ?? 0) * 60 + Number(m[11] ?? 0)) *
    1000;
  const t = new Date(Date.UTC(2000, mo - 1, d, h, mi, sec, ms));
  t.setUTCFullYear(y);
  return new Date(t.getTime() - offset);
}

const date: Decode = (b, s, e) => dateTime(text(b, s, e));

/** interval text ("1 year 2 mons 3 days 04:05:06.789"), as postgres-interval. */
function interval(b: Uint8Array, s: number, e: number): Record<string, number> {
  const str = text(b, s, e);
  const out: Record<string, number> = {};
  const units: Record<string, string> = {
    year: "years",
    mon: "months",
    day: "days",
  };
  for (const m of str.matchAll(/([+-]?\d+) (year|mon|day)s?/g)) {
    const n = Number(m[1]);
    if (n) out[units[m[2]]] = n;
  }
  const t = /([+-])?(\d+):(\d{2}):(\d{2})(?:\.(\d{1,6}))?/.exec(str);
  if (t) {
    const sign = t[1] === "-" ? -1 : 1;
    const parts: [string, number][] = [
      ["hours", Number(t[2])],
      ["minutes", Number(t[3])],
      ["seconds", Number(t[4])],
      ["milliseconds", t[5] ? Number(`0.${t[5]}`) * 1000 : 0],
    ];
    for (const [k, v] of parts) if (v) out[k] = sign * v;
  }
  return out;
}

const point: Decode = (b, s, e) => {
  const [x, y] = text(b, s + 1, e - 1).split(",").map(Number);
  return { x, y };
};

const circle: Decode = (b, s, e) => {
  const m = /^<\(([^,]+),([^)]+)\),(.+)>$/.exec(text(b, s, e));
  return m
    ? { x: Number(m[1]), y: Number(m[2]), radius: Number(m[3]) }
    : text(b, s, e);
};

// ---- arrays ------------------------------------------------------------

/** Parse an array literal ('{1,2,NULL,"a \"b\""}'), nested arrays included. */
function parseArray(src: string, item: (s: string) => unknown): unknown[] {
  // Skip explicit bounds ("[1:3]={...}").
  let i = src[0] === "[" ? src.indexOf("=") + 1 : 0;
  const parse = (): unknown[] => {
    const out: unknown[] = [];
    i++; // {
    while (i < src.length) {
      const c = src[i];
      if (c === "}") {
        i++;
        return out;
      }
      if (c === ",") {
        i++;
        continue;
      }
      if (c === "{") {
        out.push(parse());
        continue;
      }
      if (c === '"') {
        let s = "";
        i++;
        while (src[i] !== '"') {
          if (src[i] === "\\") i++;
          s += src[i++];
        }
        i++;
        out.push(item(s));
        continue;
      }
      let end = i;
      while (src[end] !== "," && src[end] !== "}") end++;
      const raw = src.slice(i, end);
      out.push(raw === "NULL" ? null : item(raw));
      i = end;
    }
    return out;
  };
  return parse();
}

/** Decode a whole array value with a decoder for its elements. */
function arrayOf(element: Decode): Decode {
  return (b, s, e) =>
    parseArray(text(b, s, e), (item) => {
      const bytes = new TextEncoder().encode(item);
      return element(bytes, 0, bytes.length);
    });
}

// ---- by type -----------------------------------------------------------

const DECODERS = new Map<number, Decode>([
  [OID.bool, bool],
  [OID.bytea, bytea],
  [OID.int8, int8], // pg gives strings; here numbers when exact
  [OID.int2, int],
  [OID.int4, int],
  [OID.oid, int],
  [OID.json, json],
  [OID.jsonb, json],
  [OID.float4, float],
  [OID.float8, float],
  [OID.date, date],
  [OID.timestamp, date],
  [OID.timestamptz, date],
  [OID.interval, interval],
  [OID.point, point],
  [OID.circle, circle],
]);

// Array types and their element types.
const ARRAYS: [number, number][] = [
  [1000, OID.bool],
  [1001, OID.bytea],
  [1005, OID.int2],
  [1007, OID.int4],
  [1016, OID.int8],
  [1028, OID.oid],
  [1021, OID.float4],
  [1022, OID.float8],
  [1182, OID.date],
  [1115, OID.timestamp],
  [1185, OID.timestamptz],
  [1187, OID.interval],
  [199, OID.json],
  [3807, OID.jsonb],
];
for (const [arr, el] of ARRAYS) DECODERS.set(arr, arrayOf(DECODERS.get(el)!));
// Arrays of text-like types: text, varchar, bpchar, name, uuid, numeric, ...
for (const arr of [1009, 1015, 1014, 1003, 2951, 1231, 1183, 1270, 791]) {
  DECODERS.set(arr, arrayOf(text));
}

/** The decoder for a column type; text for any type not listed. */
export function decoder(oid: number): Decode {
  return DECODERS.get(oid) ?? text;
}

// ---- parameters --------------------------------------------------------

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** A Date as local time with its offset, as pg sends it. */
export function dateToString(d: Date): string {
  let offset = -d.getTimezoneOffset();
  let year = d.getFullYear();
  const bc = year < 1;
  if (bc) year = Math.abs(year) + 1;
  let out = pad(year, 4) + "-" + pad(d.getMonth() + 1) + "-" +
    pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) +
    ":" + pad(d.getSeconds()) + "." + pad(d.getMilliseconds(), 3);
  if (offset < 0) {
    out += "-";
    offset *= -1;
  } else out += "+";
  out += pad(Math.floor(offset / 60)) + ":" + pad(offset % 60);
  return bc ? out + " BC" : out;
}

function hex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

function bytesOf(v: ArrayBufferView): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

/** An array as a Postgres array literal, as pg writes it. */
function arrayLiteral(list: unknown[]): string {
  const parts = list.map((v) => {
    if (v === null || v === undefined) return "NULL";
    if (Array.isArray(v)) return arrayLiteral(v);
    if (ArrayBuffer.isView(v)) return "\\\\x" + hex(bytesOf(v));
    const s = encodeParam(v) as string;
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  });
  return "{" + parts.join(",") + "}";
}

/**
 * A parameter as pg sends it: null, bytes (sent in binary), or text. Dates
 * are local time with an offset, arrays are array literals, other objects
 * JSON (or their toPostgres()), everything else String(v).
 */
export function encodeParam(v: unknown): string | Uint8Array | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return v;
  if (ArrayBuffer.isView(v)) return bytesOf(v);
  if (v instanceof Date) return dateToString(v);
  if (Array.isArray(v)) return arrayLiteral(v);
  if (typeof v === "object") {
    const custom = (v as { toPostgres?: () => unknown }).toPostgres;
    if (typeof custom === "function") {
      return encodeParam(custom.call(v));
    }
    return JSON.stringify(v);
  }
  return String(v);
}
