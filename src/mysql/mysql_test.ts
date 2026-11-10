// Tests for the built-in MySQL/MariaDB client. The server tests run only with
// DBTEST=1 and a MySQL/MariaDB server (DBHOST/DBPORT/DBUSER/DBPWD/DBNAME, or
// DBSOCKET), e.g.:
//   DBTEST=1 DBHOST=127.0.0.1 DBUSER=root DBNAME=the_test deno test -A src/mysql/
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.8";
import {
  cachingSha2Password,
  clearPassword,
  nativePassword,
  rsaEncryptPassword,
} from "./auth.ts";
import { localDate } from "./connection.ts";
import { Connection, createPool, format, MySQLError, raw } from "./mod.ts";

const hex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const scramble = new TextEncoder().encode("0123456789abcdefghij");

Deno.test("format: values and identifiers as mysql2 formats them", () => {
  const cases: [string, unknown, string][] = [
    ["a ?", ["x'y\"z\\\0\n\r\t\b\x1a"], `a 'x\\'y\\"z\\\\\\0\\n\\r\\t\\b\\Z'`],
    ["? ?? ?", [1, "t.c", null], "1 `t`.`c` NULL"],
    ["IN (?)", [[1, "a", null, true]], "IN (1, 'a', NULL, true)"],
    ["VALUES ?", [[[1, "a"], [2, "b"]]], "VALUES (1, 'a'), (2, 'b')"],
    ["SET ?", [{ a: 1, "b`c": "x", f: () => 1 }], "SET `a` = 1, `b``c` = 'x'"],
    ["? ? ?", [1], "1 ? ?"],
    ["???", [1], "???"],
    ["?", [false], "false"],
    ["?", [new Date(NaN)], "NULL"],
    ["?", 5, "5"],
    ["?", [12345678901234567890n], "'12345678901234567890'"],
    ["??", [["a", "b.c"]], "`a`, `b`.`c`"],
    ["?", [raw("NOW()")], "NOW()"],
    ["?", [{ a: { b: 1 } }], "`a` = '[object Object]'"],
    ["?", [new Uint8Array([0, 255])], "X'00ff'"],
    ["no marks", undefined, "no marks"],
  ];
  for (const [sql, values, want] of cases) {
    assertEquals(format(sql, values), want, sql);
  }
  const d = new Date(2024, 0, 2, 3, 4, 5, 6);
  assertEquals(format("?", [d]), "'2024-01-02 03:04:05.006'");
});

Deno.test("auth: native and caching_sha2 scrambles match PHP's", async () => {
  // php: sha1($p,true) ^ sha1($s . sha1(sha1($p,true),true),true), and the
  // SHA-256 equivalent for caching_sha2_password.
  assertEquals(
    hex(await nativePassword("secret pw", scramble)),
    "3d1ed8cab9b88ad56586e72d756185142c8132e2",
  );
  assertEquals(
    hex(await cachingSha2Password("secret pw", scramble)),
    "bd819444c3d84092d7e8af20c1368ac4ce048b1cedb60b4493cded35e66143b7",
  );
  assertEquals((await nativePassword("", scramble)).length, 0);
});

Deno.test("auth: RSA password is the NUL-terminated password XOR scramble", async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-1",
    },
    true,
    ["encrypt", "decrypt"],
  );
  const spki = new Uint8Array(
    await crypto.subtle.exportKey("spki", pair.publicKey),
  );
  const pem = "-----BEGIN PUBLIC KEY-----\n" +
    btoa(String.fromCharCode(...spki)).replace(/.{64}/g, "$&\n") +
    "\n-----END PUBLIC KEY-----\n";
  const sealed = await rsaEncryptPassword("pw", scramble, pem);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: "RSA-OAEP" }, pair.privateKey, sealed),
  );
  const want = clearPassword("pw").map((b, i) => b ^ scramble[i]);
  assertEquals(plain, want);
});

// ---- against a server --------------------------------------------------

const enabled = Deno.env.get("DBTEST") === "1" &&
  (Deno.env.get("DBDRIVER") ?? "mysql") !== "postgres";

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

Deno.test("localDate: the same instant as the Date constructor, DST included", () => {
  // Every 15 minutes through 2024-2025 crosses each DST change of the local
  // zone (run with TZ=... to check another one).
  const want = (y: number, mo: number, d: number, h: number, mi: number) => {
    if (y >= 100) return new Date(y, mo - 1, d, h, mi);
    const x = new Date(y + 400, mo - 1, d, h, mi);
    x.setFullYear(y);
    return x;
  };
  for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2026, 0, 1); t += 900000) {
    const x = new Date(t);
    const parts = [
      x.getUTCFullYear(),
      x.getUTCMonth() + 1,
      x.getUTCDate(),
      x.getUTCHours(),
      x.getUTCMinutes(),
    ] as const;
    assertEquals(localDate(...parts, 0, 0).getTime(), want(...parts).getTime());
  }
  for (const y of [1, 99, 100, 1850, 1900, 9999]) {
    assertEquals(
      localDate(y, 6, 15, 12, 0, 0, 0).getTime(),
      want(y, 6, 15, 12, 0).getTime(),
    );
  }
});
