// Runs spec/auth_cases.json: password hashing and the CORS switch, the same
// cases as the_lib and the_go.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.8";
import {
  bcryptInput,
  hashPassword,
  newPasswordError,
  PasswordTooLong,
  verifyPassword,
} from "./password.ts";
import { corsSetting, getCorsHeaders } from "./response.ts";

const spec = JSON.parse(
  await Deno.readTextFile(new URL("../spec/auth_cases.json", import.meta.url)),
);

for (const c of spec.verify) {
  Deno.test(`password: ${c.name}`, async () => {
    assertEquals(await verifyPassword(spec.password, c.stored), {
      ok: c.ok,
      rehash: c.rehash,
    });
  });
}

for (const c of spec.bcrypt_input) {
  Deno.test(`bcrypt input: ${c.name}`, async () => {
    assertEquals(new TextEncoder().encode(c.password).length, c.bytes);
    assertEquals([...c.password].length, c.chars);
    assertEquals(await bcryptInput(c.password), c.input);
  });
}

for (const c of spec.verify_long) {
  Deno.test(`long: ${c.name}`, async () => {
    assertEquals((await verifyPassword(c.password, c.stored)).ok, c.ok);
  });
}

for (const c of spec.new_password.cases) {
  Deno.test(`new password: ${[...c.password].length} chars -> ${c.error}`, () => {
    assertEquals(newPasswordError(c.password), c.error);
  });
}

Deno.test("password: new hashes are bcrypt cost 10, salted, and verify, long ones too", async () => {
  for (const pw of [spec.password, spec.bcrypt_input[4].password]) {
    const h = await hashPassword(pw);
    assertEquals(h.slice(0, 7), "$2b$10$");
    assertEquals(await verifyPassword(pw, h), { ok: true, rehash: false });
    assert(h !== await hashPassword(pw));
  }
});

Deno.test("password: over 128 characters is refused, with no word about hashing", async () => {
  const err = await assertRejects(
    () => hashPassword("a".repeat(129)),
    PasswordTooLong,
  );
  assertEquals(err.message, spec.new_password.too_long);
  for (const m of [spec.new_password.too_long, spec.new_password.too_short]) {
    assert(!/72|byte|bcrypt|sha|hash/i.test(m), m);
  }
});

for (const c of spec.cors) {
  Deno.test(`cors: ${c.name}`, () => {
    const h = getCorsHeaders(
      c.origin || undefined,
      corsSetting(c.cors, c.origins),
    );
    assertEquals(h["Access-Control-Allow-Origin"] ?? null, c.allow);
    if (c.allow) assertEquals(h["Access-Control-Allow-Credentials"], "true");
  });
}
