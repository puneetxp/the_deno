// Tests of the MySQL/MariaDB client against a server. They run only with
// DBTEST=1 and a MySQL/MariaDB server (DBHOST/DBPORT/DBUSER/DBPWD/DBNAME, or
// DBSOCKET), and create and drop the_my_t and the_my_p, e.g.:
//   DBTEST=1 DBHOST=127.0.0.1 DBUSER=root DBNAME=the_test deno test -A src/mysql/
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.8";
import { Connection, createPool, MySQLError } from "./mod.ts";

const enabled = Deno.env.get("DBTEST") === "1" &&
  (Deno.env.get("DBDRIVER") ?? "mysql") !== "postgres";

// DBSSL=on (+ DBSSL_CA, a PEM file) tests over TLS.
function tls() {
  if (!["on", "1", "true"].includes(Deno.env.get("DBSSL") ?? "")) return false;
  const ca = Deno.env.get("DBSSL_CA");
  return ca ? { caCerts: [Deno.readTextFileSync(ca)] } : true;
}

function opts() {
  const socketPath = Deno.env.get("DBSOCKET");
  return {
    ...(socketPath ? { socketPath } : {
      host: Deno.env.get("DBHOST") ?? "127.0.0.1",
      port: Number(Deno.env.get("DBPORT") ?? "3306"),
    }),
    user: Deno.env.get("DBUSER"),
    password: Deno.env.get("DBPWD"),
    database: Deno.env.get("DBNAME"),
    tls: tls(),
  };
}

Deno.test({
  name: "server: types, write results, errors, multiple results",
  ignore: !enabled,
  async fn() {
    const pool = createPool({ ...opts(), connectionLimit: 2 });
    try {
      const [rows] = await pool.query(
        "SELECT ? AS s, 1 AS i, 2.5e0 AS f, CAST(1.50 AS DECIMAL(5,2)) AS d, " +
          "NULL AS z, X'00ff' AS b, CAST('2024-02-29 10:20:30.456' AS DATETIME(3)) AS dt, " +
          "CAST(18446744073709551615 AS UNSIGNED) AS big",
        ["héllo ✓ 😀"],
      ) as [Record<string, unknown>[], unknown];
      assertEquals(rows[0].s, "héllo ✓ 😀");
      assertEquals(rows[0].i, 1);
      assertEquals(rows[0].f, 2.5);
      assertEquals(rows[0].d, "1.50");
      assertEquals(rows[0].z, null);
      assertEquals(rows[0].b, new Uint8Array([0, 255]));
      assertEquals(rows[0].dt, new Date(2024, 1, 29, 10, 20, 30, 456));
      assertEquals(rows[0].big, "18446744073709551615");

      await pool.query("DROP TABLE IF EXISTS the_my_t");
      await pool.query(
        "CREATE TABLE the_my_t (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20) UNIQUE)",
      );
      const [ins] = await pool.query("INSERT INTO the_my_t (name) VALUES ?", [
        [["a"], ["b"]],
      ]) as [{ insertId: number; affectedRows: number }, unknown];
      assertEquals([ins.insertId, ins.affectedRows], [1, 2]);
      const [upd] = await pool.query(
        "UPDATE the_my_t SET name = name WHERE id IN (?)",
        [[1, 2]],
      ) as [{ affectedRows: number; changedRows: number }, unknown];
      // FOUND_ROWS, as in mysql2: matched rows, though none changed.
      assertEquals([upd.affectedRows, upd.changedRows], [2, 0]);

      const dup = await assertRejects(
        () => pool.query("INSERT INTO the_my_t (name) VALUES ('a')"),
        MySQLError,
      );
      assertEquals([dup.code, dup.errno, dup.sqlState], [
        "ER_DUP_ENTRY",
        1062,
        "23000",
      ]);
      // The connection is still fine after a server error.
      const [after] = await pool.query(
        "SELECT COUNT(*) AS c FROM the_my_t",
      ) as [
        { c: number }[],
        unknown,
      ];
      assertEquals(after[0].c, 2);

      await pool.query("DROP PROCEDURE IF EXISTS the_my_p");
      await pool.query(
        "CREATE PROCEDURE the_my_p() BEGIN SELECT 1 AS a; SELECT 2 AS b; END",
      );
      const [sets] = await pool.query("CALL the_my_p()") as [
        unknown[],
        unknown,
      ];
      assertEquals(sets.length, 3); // two row sets and the CALL's own result
      assertEquals(sets[0], [{ a: 1 }]);
      assertEquals(sets[1], [{ b: 2 }]);
      await pool.query("DROP PROCEDURE the_my_p");
      await pool.query("DROP TABLE the_my_t");
    } finally {
      await pool.end();
    }
  },
});

Deno.test({
  name: "server: a killed idle connection is dropped, not reused",
  ignore: !enabled,
  async fn() {
    const pool = createPool({ ...opts(), connectionLimit: 1 });
    const admin = await Connection.connect(opts());
    try {
      const [r] = await pool.query("SELECT CONNECTION_ID() AS id") as [
        { id: number }[],
        unknown,
      ];
      await admin.query(`KILL ${r[0].id}`);
      // Give the pool's pending read time to see the close.
      await new Promise((ok) => setTimeout(ok, 100));
      const [r2] = await pool.query("SELECT CONNECTION_ID() AS id") as [
        { id: number }[],
        unknown,
      ];
      assert(r2[0].id !== r[0].id);
    } finally {
      await admin.close();
      await pool.end();
    }
  },
});

Deno.test({
  name: "server: the pool queues past its limit and keeps order per query",
  ignore: !enabled,
  async fn() {
    const pool = createPool({ ...opts(), connectionLimit: 2 });
    try {
      const out = await Promise.all(
        Array.from(
          { length: 10 },
          (_, i) => pool.query("SELECT ? AS i, CONNECTION_ID() AS c", [i]),
        ),
      ) as [{ i: number; c: number }[], unknown][];
      assertEquals(out.map(([rows]) => rows[0].i), [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
      ]);
      assert(new Set(out.map(([rows]) => rows[0].c)).size <= 2);
    } finally {
      await pool.end();
    }
    await assertRejects(
      () => pool.query("SELECT 1"),
      MySQLError,
      "pool is closed",
    );
  },
});

Deno.test({
  name: "server: a wrong password is rejected with the server's error",
  ignore: !enabled || !!Deno.env.get("DBSOCKET"),
  async fn() {
    const err = await assertRejects(
      () => Connection.connect({ ...opts(), password: "wrong-" + Date.now() }),
      MySQLError,
    );
    assertEquals(err.code, "ER_ACCESS_DENIED_ERROR");
  },
});
