// Tests of the PostgreSQL client against a server. They run only with
// DBTEST=1 DBDRIVER=postgres (DBHOST/DBPORT/DBUSER/DBPWD/DBNAME, or DBSOCKET
// for a socket directory), and create and drop the_pg_t, e.g.:
//   DBTEST=1 DBDRIVER=postgres DBHOST=127.0.0.1 DBUSER=postgres \
//   DBNAME=the_test deno test -A src/postgres/
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.8";
import { Connection, createPool, PostgresError } from "./mod.ts";
import type { QueryResult } from "./types.ts";

const enabled = Deno.env.get("DBTEST") === "1" &&
  ["postgres", "postgresql", "pg"].includes(Deno.env.get("DBDRIVER") ?? "");

// DBSSL=on (+ DBSSL_CA, a PEM file) tests over TLS.
function tls() {
  if (!["on", "1", "true"].includes(Deno.env.get("DBSSL") ?? "")) return false;
  const ca = Deno.env.get("DBSSL_CA");
  return ca ? { caCerts: [Deno.readTextFileSync(ca)] } : true;
}

function opts() {
  return {
    host: Deno.env.get("DBSOCKET") || Deno.env.get("DBHOST") || "127.0.0.1",
    port: Number(Deno.env.get("DBPORT") ?? "5432"),
    user: Deno.env.get("DBUSER"),
    password: Deno.env.get("DBPWD"),
    database: Deno.env.get("DBNAME"),
    tls: tls(),
  };
}

// PGlite (used to test on some machines) serves one connection at a time:
// run it with DBPOOL=1.
const max = Number(Deno.env.get("DBPOOL") ?? "2");

Deno.test({
  name: "server: types, write results, errors, several statements",
  ignore: !enabled,
  async fn() {
    const pool = createPool({ ...opts(), max });
    try {
      const r = await pool.query(
        "SELECT $1::text AS s, $2::int AS i, 1.50::numeric AS n, NULL AS z, " +
          "'\\x00ff'::bytea AS b, '2024-02-29 10:20:30.456'::timestamp AS ts, " +
          "9007199254740993::int8 AS big, true AS bo, '{1,NULL}'::int[] AS a, " +
          "'{\"k\":1}'::jsonb AS j",
        ["héllo ✓ 😀", 42],
      ) as QueryResult;
      assertEquals(r.command, "SELECT");
      assertEquals(r.rows[0], {
        s: "héllo ✓ 😀",
        i: 42,
        n: "1.50",
        z: null,
        b: new Uint8Array([0, 255]),
        ts: new Date(2024, 1, 29, 10, 20, 30, 456),
        big: "9007199254740993",
        bo: true,
        a: [1, null],
        j: { k: 1 },
      });

      await pool.query("DROP TABLE IF EXISTS the_pg_t");
      await pool.query(
        "CREATE TABLE the_pg_t (id serial PRIMARY KEY, name text UNIQUE)",
      );
      const ins = await pool.query(
        "INSERT INTO the_pg_t (name) VALUES ($1), ($2) RETURNING id",
        ["a", "b"],
      ) as QueryResult;
      assertEquals([ins.command, ins.rowCount, ins.rows], [
        "INSERT",
        2,
        [{ id: 1 }, { id: 2 }],
      ]);

      const dup = await assertRejects(
        () => pool.query("INSERT INTO the_pg_t (name) VALUES ($1)", ["a"]),
        PostgresError,
      );
      assertEquals([dup.code, dup.constraint, dup.fatal], [
        "23505",
        "the_pg_t_name_key",
        false,
      ]);
      // The connection is fine after a server error, in either protocol.
      await assertRejects(() => pool.query("SELEC 1"), PostgresError);
      const count = await pool.query(
        "SELECT count(*) AS c FROM the_pg_t",
      ) as QueryResult;
      assertEquals(count.rows, [{ c: 2 }]);

      const several = await pool.query(
        "SELECT 1 AS a; UPDATE the_pg_t SET name = name; SELECT 'x' AS b",
      ) as QueryResult[];
      assertEquals(several.map((x) => [x.command, x.rowCount]), [
        ["SELECT", 1],
        ["UPDATE", 2],
        ["SELECT", 1],
      ]);
      assertEquals(several[2].rows, [{ b: "x" }]);

      // A notice during a query is skipped.
      await pool.query("DO $$ BEGIN RAISE NOTICE 'hello'; END $$");
      await pool.query("DROP TABLE the_pg_t");
    } finally {
      await pool.end();
    }
  },
});

Deno.test({
  name: "server: the pool queues past its limit and keeps each query's answer",
  ignore: !enabled,
  async fn() {
    const pool = createPool({ ...opts(), max });
    try {
      const out = await Promise.all(
        Array.from(
          { length: 10 },
          (_, i) =>
            pool.query("SELECT $1::int AS i", [i]) as Promise<QueryResult>,
        ),
      );
      assertEquals(out.map((r) => r.rows[0].i), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    } finally {
      await pool.end();
    }
    await assertRejects(() => pool.query("SELECT 1"), PostgresError, "closed");
  },
});

Deno.test({
  name: "server: a connection the server ends is not reused",
  ignore: !enabled,
  async fn() {
    const pool = createPool({ ...opts(), max: 1 });
    try {
      // Ends this session from the server side (FATAL 57P01).
      await pool.query("SELECT pg_terminate_backend(pg_backend_pid())")
        .catch(() => {});
      await new Promise((ok) => setTimeout(ok, 100));
      const r = await pool.query("SELECT 1 AS one") as QueryResult;
      assertEquals(r.rows, [{ one: 1 }]);
    } finally {
      await pool.end();
    }
  },
});

Deno.test({
  name: "server: close() returns even if the server keeps the socket open",
  ignore: !enabled,
  async fn() {
    const c = await Connection.connect(opts());
    assert(c.parameters.server_version);
    await c.close();
    assert(c.closed);
  },
});
