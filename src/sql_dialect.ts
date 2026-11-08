// SQL dialect helpers. The query builder writes MySQL-style SQL (`?`
// placeholders, backtick-quoted identifiers); for PostgreSQL it is rewritten
// once, right before it is sent to the server.

export type DBDriver = "mysql" | "postgres";

export function resolveDriver(value: string | undefined): DBDriver {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "" || v === "mysql" || v === "mariadb" || v === "mysql2") {
    return "mysql";
  }
  if (v === "postgres" || v === "postgresql" || v === "pg") return "postgres";
  throw new Error(
    `Unknown DBDRIVER "${value}". Use "mysql" (default) or "postgres".`,
  );
}

/**
 * Rewrite MySQL-style SQL for PostgreSQL:
 * - `?` placeholders become `$1`, `$2`, ... in order;
 * - backtick-quoted identifiers become double-quoted (a doubled backtick
 *   inside one becomes a literal backtick).
 *
 * Text inside single-quoted strings, double-quoted identifiers, dollar-quoted
 * strings and `--` or C-style comments is left untouched. SQL that already
 * uses `$n` placeholders is returned unchanged, so code written for PostgreSQL
 * keeps working.
 */
export function toPostgresSQL(sql: string): string {
  let out = "";
  let n = 0;
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];

    if (ch === "'") {
      const end = skipQuoted(sql, i, "'");
      out += sql.slice(i, end);
      i = end;
    } else if (ch === '"') {
      const end = skipQuoted(sql, i, '"');
      out += sql.slice(i, end);
      i = end;
    } else if (ch === "`") {
      let j = i + 1;
      let ident = "";
      while (j < len) {
        if (sql[j] === "`") {
          if (sql[j + 1] === "`") {
            ident += "`";
            j += 2;
            continue;
          }
          break;
        }
        ident += sql[j];
        j++;
      }
      out += '"' + ident.replaceAll('"', '""') + '"';
      i = j + 1;
    } else if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? len : nl;
      out += sql.slice(i, end);
      i = end;
    } else if (ch === "/" && sql[i + 1] === "*") {
      const close = sql.indexOf("*/", i + 2);
      const end = close === -1 ? len : close + 2;
      out += sql.slice(i, end);
      i = end;
    } else if (ch === "$") {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const end = close === -1 ? len : close + tag[0].length;
        out += sql.slice(i, end);
        i = end;
      } else {
        out += ch;
        i++;
      }
    } else if (ch === "?") {
      out += "$" + (++n);
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

// Index just past the closing quote; a doubled quote is an escaped quote.
function skipQuoted(sql: string, start: number, q: string): number {
  let j = start + 1;
  while (j < sql.length) {
    if (sql[j] === q) {
      if (sql[j + 1] === q) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    if (q === "'" && sql[j] === "\\" && j + 1 < sql.length) {
      // MySQL-style backslash escape; harmless to skip in PostgreSQL too,
      // where it only appears with standard_conforming_strings off.
      j += 2;
      continue;
    }
    j++;
  }
  return sql.length;
}

/** Quote one identifier MySQL-style; rewritten for PostgreSQL at execution. */
export function ident(name: string): string {
  return "`" + name.replaceAll("`", "``") + "`";
}

/** Result of an INSERT/UPDATE/DELETE, the same shape for both drivers. */
export type WriteResult = {
  insertId: number | null;
  affectedRows: number;
  /** Ids of every inserted row, when the driver reports them (PostgreSQL). */
  insertIds?: number[];
};
