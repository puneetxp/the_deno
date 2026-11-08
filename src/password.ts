// Password hashing shared by every adapter (spec/auth_cases.json): bcrypt
// (src/bcrypt.ts, no npm packages),
// cost 10. Hashes from the Deno, PHP and Go adapters verify in each other.
// Older accounts hold an unsalted SHA3-256 hash (the_deno: base64, the_lib:
// hex); they still log in, and verifyPassword says to re-hash them.

import { bcryptCost, bcryptHash, bcryptVerify } from "./bcrypt.ts";
import { crypto, encodeBase64 } from "../deps.ts";

export const PASSWORD_COST = 10;
/** bcrypt reads only the first 72 bytes; longer passwords are refused. */
export const PASSWORD_MAX_BYTES = 72;

export class PasswordTooLong extends Error {
  constructor() {
    super(`Password must be at most ${PASSWORD_MAX_BYTES} bytes`);
  }
}

/** The bcrypt hash to store for password. */
export async function hashPassword(password: string): Promise<string> {
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    throw new PasswordTooLong();
  }
  return await Promise.resolve(bcryptHash(password, PASSWORD_COST));
}

function sameString(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Check password against a stored hash. rehash: replace the stored hash
 * (old SHA3, or bcrypt of another cost) once the password is known good.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<{ ok: boolean; rehash: boolean }> {
  if (!stored) return { ok: false, rehash: false };
  if (stored.startsWith("$2")) {
    const ok = bcryptVerify(password, stored);
    return { ok, rehash: ok && bcryptCost(stored) !== PASSWORD_COST };
  }
  const raw = new Uint8Array(
    await crypto.subtle.digest(
      "SHA3-256",
      new TextEncoder().encode(password),
    ),
  );
  const hex = Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
  const ok = sameString(encodeBase64(raw), stored) || sameString(hex, stored);
  return { ok, rehash: ok };
}
