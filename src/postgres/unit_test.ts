// Unit tests for the PostgreSQL client: no server needed.
import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@1.0.8";
import { md5Password, Scram } from "./auth.ts";
import { parseFields, serverError } from "./errors.ts";
import { B, Reader, Writer } from "./protocol.ts";
import { decodeRow } from "./query.ts";
import { dateToString, decoder, encodeParam, OID } from "./values.ts";

const bytes = (s: string) => new TextEncoder().encode(s);
const decode = (oid: number, s: string) => {
  const b = bytes(s);
  return decoder(oid)(b, 0, b.length);
};

Deno.test("auth: md5 matches PHP's md5(md5(pw . user) . salt)", async () => {
  assertEquals(
    await md5Password("alice", "secret pw", new Uint8Array([1, 2, 3, 4])),
    "md537ad90a7671c1a017f91a5e96fde57ac",
  );
});

Deno.test("auth: SCRAM-SHA-256 gives RFC 7677's example messages", async () => {
  // RFC 7677 section 3: user "user", password "pencil".
  const scram = new Scram("pencil", "rOprNGfwEbeRWgbNEkqO");
  const serverFirst =
    "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096";
  const final = await scram.final(serverFirst, "n=user,r=rOprNGfwEbeRWgbNEkqO");
  assertEquals(
    final,
    "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=",
  );
  scram.verify("v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=");
  assertThrows(() => scram.verify("v=AAAA"), Error, "does not match");
});

Deno.test("auth: SCRAM refuses a server nonce that does not extend ours", async () => {
  const scram = new Scram("pw", "abc");
  await assertRejects(() => scram.final("r=xyz123,s=AAAA,i=4096"));
  await assertRejects(() => scram.final("r=abc,s=AAAA,i=4096"));
});

Deno.test("protocol: writer framing and reader fields", () => {
  const msg = new Writer().start(B.CommandComplete).cstr("INSERT 0 5").done();
  assertEquals(msg[0], B.CommandComplete);
  const r = new Reader(msg);
  r.u8();
  assertEquals(r.i32(), msg.length - 1);
  assertEquals(r.cstr(), "INSERT 0 5");
  // Several messages in one writer.
  const two = new Writer().start(0x53).start(0x53).done();
  assertEquals(two, new Uint8Array([0x53, 0, 0, 0, 4, 0x53, 0, 0, 0, 4]));
});

Deno.test("errors: ErrorResponse fields under pg's names", () => {
  const body = bytes(
    "SERROR\0VERROR\0C23505\0Mduplicate key value\0Dthe detail\0tpt\0npt_pkey\0\0",
  );
  assertEquals(parseFields(body).C, "23505");
  const e = serverError(body);
  assertEquals(
    [e.message, e.code, e.severity, e.detail, e.table, e.constraint, e.fatal],
    [
      "duplicate key value",
      "23505",
      "ERROR",
      "the detail",
      "pt",
      "pt_pkey",
      false,
    ],
  );
  assertEquals(serverError(bytes("SFATAL\0C57P01\0Mbye\0\0")).fatal, true);
});

Deno.test("values: decoders by type", () => {
  assertEquals(decode(OID.int4, "-42"), -42);
  assertEquals(decode(OID.int8, "9007199254740991"), 9007199254740991);
  assertEquals(decode(OID.int8, "9007199254740993"), "9007199254740993");
  assertEquals(decode(OID.float8, "NaN"), NaN);
  assertEquals(decode(OID.float8, "-Infinity"), -Infinity);
  assertEquals(decode(OID.bool, "t"), true);
  assertEquals(decode(OID.bool, "f"), false);
  assertEquals(decode(1700, "1.50"), "1.50"); // numeric stays a string
  assertEquals(decode(OID.jsonb, '{"a":[1]}'), { a: [1] });
  assertEquals(decode(OID.bytea, "\\x00ff10"), new Uint8Array([0, 255, 16]));
  assertEquals(
    decode(OID.bytea, "a\\\\b\\001"),
    new Uint8Array([97, 92, 98, 1]),
  );
  assertEquals(decode(OID.date, "2024-02-29"), new Date(2024, 1, 29));
  assertEquals(
    decode(OID.timestamp, "2024-03-01 10:20:30.456"),
    new Date(2024, 2, 1, 10, 20, 30, 456),
  );
  assertEquals(
    decode(OID.timestamptz, "2024-03-01 10:20:30.456+05:30"),
    new Date(Date.UTC(2024, 2, 1, 4, 50, 30, 456)),
  );
  assertEquals(decode(OID.timestamptz, "infinity"), Infinity);
  assertEquals(
    (decode(OID.date, "0044-03-15 BC") as Date).getFullYear(),
    -43,
  );
  assertEquals(decode(OID.interval, "1 year 2 mons 3 days 04:05:06.789"), {
    years: 1,
    months: 2,
    days: 3,
    hours: 4,
    minutes: 5,
    seconds: 6,
    milliseconds: 789,
  });
  assertEquals(decode(OID.interval, "-1 days +02:00:00"), {
    days: -1,
    hours: 2,
  });
  assertEquals(decode(OID.point, "(1.5,2)"), { x: 1.5, y: 2 });
});

Deno.test("values: arrays", () => {
  assertEquals(decode(1007, "{1,2,NULL}"), [1, 2, null]);
  assertEquals(decode(1007, "{{1,2},{3,4}}"), [[1, 2], [3, 4]]);
  assertEquals(decode(1009, '{"a,b","q\\"",NULL,"x y",plain}'), [
    "a,b",
    'q"',
    null,
    "x y",
    "plain",
  ]);
  assertEquals(decode(1009, '{"NULL"}'), ["NULL"]); // quoted: the text
  assertEquals(decode(1007, "[0:1]={5,6}"), [5, 6]);
  assertEquals(decode(1000, "{t,f}"), [true, false]);
});

Deno.test("values: parameters as pg sends them", () => {
  assertEquals(encodeParam(null), null);
  assertEquals(encodeParam(undefined), null);
  assertEquals(encodeParam(5), "5");
  assertEquals(encodeParam(true), "true");
  assertEquals(encodeParam(12345678901234567890n), "12345678901234567890");
  assertEquals(encodeParam({ a: 1 }), '{"a":1}');
  assertEquals(encodeParam({ toPostgres: () => "custom" }), "custom");
  assertEquals(
    encodeParam([1, null, 'a"b\\', [2]]),
    '{"1",NULL,"a\\"b\\\\",{"2"}}',
  );
  assertEquals(encodeParam(new Uint8Array([1, 2])), new Uint8Array([1, 2]));
  assertEquals(encodeParam([new Uint8Array([255])]), "{\\\\xff}");
  const d = new Date(2024, 0, 2, 3, 4, 5, 6);
  const s = dateToString(d);
  assertEquals(s.slice(0, 23), "2024-01-02T03:04:05.006");
  assertEquals(new Date(s).getTime(), d.getTime());
});

Deno.test("query: DataRow decoding, NULLs included", () => {
  const w = new Writer().start(B.DataRow).i16(3);
  w.i32(2).bytes(bytes("42"));
  w.i32(-1);
  w.i32(3).bytes(bytes("abc"));
  const msg = w.done();
  const body = msg.subarray(5);
  const row = decodeRow(body, ["a", "b", "c"], [
    decoder(OID.int4),
    decoder(25),
    decoder(25),
  ]);
  assertEquals(row, { a: 42, b: null, c: "abc" });
});
