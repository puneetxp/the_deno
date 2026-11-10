// Unit tests for the MySQL/MariaDB client: no server needed.
import { assertEquals } from "jsr:@std/assert@1.0.8";
import {
  cachingSha2Password,
  clearPassword,
  nativePassword,
  rsaEncryptPassword,
} from "./auth.ts";
import { format, raw } from "./format.ts";
import { localDate } from "../local_date.ts";

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
