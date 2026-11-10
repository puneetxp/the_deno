// Client-side placeholder formatting for MySQL/MariaDB.
//
// This matches what npm:mysql2's pool.query(sql, values) did (it uses the
// sqlstring package): each `?` becomes an escaped value and each `??` an
// escaped identifier, left to right. Keeping the same rules means the SQL the
// model layer builds reaches the server byte for byte as before.

// deno-lint-ignore no-control-regex -- these are the bytes MySQL escapes
const CHARS = /[\0\b\t\n\r\x1a"'\\]/g;
const CHAR_ESCAPES: Record<string, string> = {
  "\0": "\\0",
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\r": "\\r",
  "\x1a": "\\Z",
  '"': '\\"',
  "'": "\\'",
  "\\": "\\\\",
};

/** A value that is put into the SQL as is, e.g. `raw("NOW()")`. */
export type RawSQL = { toSqlString(): string };

export function raw(sql: string): RawSQL {
  return { toSqlString: () => sql };
}

function isRaw(v: unknown): v is RawSQL {
  return typeof v === "object" && v !== null &&
    typeof (v as RawSQL).toSqlString === "function";
}

export function escapeString(s: string): string {
  return "'" + s.replace(CHARS, (c) => CHAR_ESCAPES[c]) + "'";
}

export function escapeId(id: unknown, forbidQualified = false): string {
  if (Array.isArray(id)) {
    return id.map((part) => escapeId(part, forbidQualified)).join(", ");
  }
  const s = String(id);
  if (forbidQualified) return "`" + s.replace(/`/g, "``") + "`";
  return "`" + s.replace(/`/g, "``").replace(/\./g, "`.`") + "`";
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** A Date as local time, 'YYYY-MM-DD HH:MM:SS.mmm' (as mysql2 does). */
export function dateToSQL(d: Date): string {
  if (isNaN(d.getTime())) return "NULL";
  return "'" + pad(d.getFullYear(), 4) + "-" + pad(d.getMonth() + 1) + "-" +
    pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) +
    ":" + pad(d.getSeconds()) + "." + pad(d.getMilliseconds(), 3) + "'";
}

function bytesToSQL(b: Uint8Array): string {
  let hex = "";
  for (const byte of b) hex += byte.toString(16).padStart(2, "0");
  return "X'" + hex + "'";
}

function arrayToList(list: unknown[]): string {
  return list.map((v) =>
    Array.isArray(v) ? "(" + arrayToList(v) + ")" : escape(v, true)
  ).join(", ");
}

function objectToValues(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key in obj) {
    const v = obj[key];
    if (typeof v === "function") continue;
    parts.push(escapeId(key) + " = " + escape(v, true));
  }
  return parts.join(", ");
}

/** One value as SQL. */
export function escape(v: unknown, nested = false): string {
  if (v === undefined || v === null) return "NULL";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "number":
      return String(v);
    case "bigint":
      return "'" + v + "'"; // quoted, as mysql2 does
    case "string":
      return escapeString(v);
    case "object":
      if (v instanceof Date) return dateToSQL(v);
      if (v instanceof Uint8Array) return bytesToSQL(v);
      if (ArrayBuffer.isView(v)) {
        return bytesToSQL(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      }
      if (Array.isArray(v)) return arrayToList(v);
      if (isRaw(v)) return v.toSqlString();
      return nested
        ? escapeString(String(v))
        : objectToValues(v as Record<string, unknown>);
    default:
      return escapeString(String(v));
  }
}

/** Replace `?` with values and `??` with identifiers, in order. */
export function format(sql: string, values?: unknown): string {
  if (values === undefined || values === null) return sql;
  const list = Array.isArray(values) ? values : [values];
  let i = 0;
  return sql.replace(/\?+/g, (marks) => {
    if (i >= list.length || marks.length > 2) return marks;
    const v = list[i++];
    return marks.length === 2 ? escapeId(v) : escape(v);
  });
}
