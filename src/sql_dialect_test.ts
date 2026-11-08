import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.8";
import { ident, resolveDriver, toPostgresSQL } from "./sql_dialect.ts";

Deno.test("placeholders are numbered in order", () => {
  assertEquals(
    toPostgresSQL("SELECT * FROM t WHERE `a` IN (?, ?) AND `b` = ? LIMIT 1"),
    'SELECT * FROM t WHERE "a" IN ($1, $2) AND "b" = $3 LIMIT 1',
  );
});

Deno.test("quoted strings, identifiers and comments are left alone", () => {
  assertEquals(
    toPostgresSQL("SELECT 'it''s ? `x`', \"a?b\" FROM t -- why?\nWHERE x = ?"),
    "SELECT 'it''s ? `x`', \"a?b\" FROM t -- why?\nWHERE x = $1",
  );
  assertEquals(
    toPostgresSQL("SELECT /* ? */ $tag$ ? `y` $tag$, $$?$$, ?"),
    "SELECT /* ? */ $tag$ ? `y` $tag$, $$?$$, $1",
  );
  assertEquals(toPostgresSQL("SELECT 'a\\'?' , ?"), "SELECT 'a\\'?' , $1");
});

Deno.test("SQL already written for PostgreSQL is unchanged", () => {
  const sql = 'SELECT * FROM t WHERE "id" = $1 AND x::text = $2';
  assertEquals(toPostgresSQL(sql), sql);
});

Deno.test("backtick identifiers with escapes", () => {
  assertEquals(toPostgresSQL("`we``ird`"), '"we`ird"');
  assertEquals(toPostgresSQL('`has"quote`'), '"has""quote"');
  assertEquals(ident("we`ird"), "`we``ird`");
  assertEquals(toPostgresSQL(ident("order")), '"order"');
});

Deno.test("driver names", () => {
  assertEquals(resolveDriver(undefined), "mysql");
  assertEquals(resolveDriver(""), "mysql");
  assertEquals(resolveDriver("MariaDB"), "mysql");
  assertEquals(resolveDriver("postgresql"), "postgres");
  assertEquals(resolveDriver("pg"), "postgres");
  assertThrows(() => resolveDriver("sqlite"), Error, "Unknown DBDRIVER");
});
