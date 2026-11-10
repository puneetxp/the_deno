// Turning column values from the text protocol into JS values, with mysql2's
// defaults. This is the hot path of large selects: every function here runs
// once per value, on bytes [s, e) of a row packet, without copying them.

import { BINARY_CHARSET, dec, T } from "./protocol.ts";
import type { Field } from "./types.ts";
import { localDate } from "../local_date.ts";

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

/** An integer from ASCII digits; past 15 digits, exact as a string if unsafe. */
export function int(b: Uint8Array, s: number, e: number): number | string {
  if (e - s > 15) {
    const str = text(b, s, e);
    const n = Number(str);
    return Number.isSafeInteger(n) ? n : str;
  }
  let i = s;
  let neg = false;
  if (b[i] === 0x2d) { // '-'
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
export function date(b: Uint8Array, s: number, e: number): Date {
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
      // Fractions have 1-6 digits; milliseconds are the first three.
      const end = Math.min(e, s + 23);
      ms = digits(b, s + 20, end) *
        (end - s === 21 ? 100 : end - s === 22 ? 10 : 1);
    }
  }
  return localDate(y, mo, d, h, mi, sec, ms);
}

// ---- per-column casts --------------------------------------------------

/** Turns bytes [s, e) of a row packet into one JS value. */
export type Cast = (b: Uint8Array, s: number, e: number) => unknown;

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
export function caster(f: Field): Cast {
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
    case T.JSON: // MySQL's JSON type; MariaDB sends JSON columns as text
      return castJSON;
    case T.BIT:
      return castBytes;
    default:
      return f.characterSet === BINARY_CHARSET ? castBytes : text;
  }
}
