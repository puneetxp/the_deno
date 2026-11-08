// bcrypt against PHP's password_hash() (spec/bcrypt_vectors.json) and the
// cross-adapter hashes in spec/auth_cases.json.
import { assert, assertEquals } from "jsr:@std/assert@1.0.8";
import { bcryptCost, bcryptHash, bcryptVerify } from "./bcrypt.ts";
import { PI_WORDS } from "./bcrypt_pi.ts";

const vectors = JSON.parse(
  await Deno.readTextFile(
    new URL("../spec/bcrypt_vectors.json", import.meta.url),
  ),
).vectors;
const B64 = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function saltOf(hash: string): Uint8Array { // decode the 22-char salt (16 bytes)
  const s = hash.slice(7, 29);
  const bits = [...s].map((c) => B64.indexOf(c).toString(2).padStart(6, "0"))
    .join("").slice(0, 128);
  return Uint8Array.from(
    { length: 16 },
    (_, i) => parseInt(bits.slice(8 * i, 8 * i + 8), 2),
  );
}

Deno.test("Blowfish constants are pi's hex digits (published first and last values)", () => {
  assertEquals(PI_WORDS.length, 1042);
  assertEquals([PI_WORDS[0], PI_WORDS[17], PI_WORDS[18], PI_WORDS[1041]], [
    0x243f6a88,
    0x8979fb1b,
    0xd1310ba6,
    0x3ac372e6,
  ]);
});

for (const v of vectors) {
  const label = `${JSON.stringify(v.password).slice(0, 24)} cost ${
    v.hash.slice(4, 6)
  }`;
  Deno.test(`same digest as PHP from the same salt: ${label}`, () => {
    const cost = Number(v.hash.slice(4, 6));
    assertEquals(
      bcryptHash(v.password, cost, saltOf(v.hash)).slice(4),
      v.hash.slice(4),
    );
  });
  Deno.test(`verifies PHP's hash: ${label}`, () => {
    assert(bcryptVerify(v.password, v.hash));
    // A different password fails. (Appending to one of 72+ bytes would still
    // match: bcrypt reads only the first 72 bytes, which is why register refuses longer.)
    assert(!bcryptVerify("#" + v.password.slice(1), v.hash));
  });
}

Deno.test("verifies Go's $2a$ and rejects malformed hashes", () => {
  assert(
    bcryptVerify(
      "s3cret-Pä55",
      "$2a$10$qN/B7CkpPchXnQSfJxCu7.w2QRkR.lpABxWTbxSwGKLURe4k/I5be",
    ),
  );
  for (
    const bad of [
      "",
      "$2a$10$short",
      "$3a$10$qN/B7CkpPchXnQSfJxCu7.w2QRkR.lpABxWTbxSwGKLURe4k/I5be",
      "$2a$03$qN/B7CkpPchXnQSfJxCu7.w2QRkR.lpABxWTbxSwGKLURe4k/I5be",
    ]
  ) {
    assertEquals(bcryptVerify("s3cret-Pä55", bad), false, bad);
  }
});

Deno.test("new hashes: $2b$, salted, cost readable", () => {
  const a = bcryptHash("pw", 4), b = bcryptHash("pw", 4);
  assert(a.startsWith("$2b$04$") && a !== b);
  assertEquals(bcryptCost(a), 4);
  assert(bcryptVerify("pw", a));
});
