// Runs spec/auth_cases.json: password hashing and the CORS switch, the same
// cases as the_lib and the_go.
import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.8";
import { hashPassword, PasswordTooLong, verifyPassword } from "./password.ts";
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

Deno.test("password: a new hash is bcrypt cost 10, salted, and verifies", async () => {
  const h = await hashPassword(spec.password);
  assertEquals(h.slice(0, 7), "$2a$10$");
  assertEquals(await verifyPassword(spec.password, h), {
    ok: true,
    rehash: false,
  });
  assertEquals(h === await hashPassword(spec.password), false);
});

Deno.test("password: over 72 bytes is refused", async () => {
  await assertRejects(() => hashPassword(spec.too_long), PasswordTooLong);
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
