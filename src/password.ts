// Password hashing shared by every adapter (spec/auth_cases.json): bcrypt
// (src/bcrypt.ts, no npm packages), cost 10. Hashes from the Deno, PHP and Go
// adapters verify in each other.
//
// bcrypt reads only 72 bytes, so a longer password is first reduced to
// base64(SHA3-256(password)), 44 characters (bcryptInput). Every byte of a long
// password counts, and the stored hash is still a plain bcrypt string.
//
// A new password must have 6 to 128 characters; the messages say nothing
// about how passwords are stored.
//
// Older accounts hold an unsalted SHA3-256 hash (the_deno: base64, the_lib:
// hex); they still log in, and verifyPassword says to re-hash them.

import { bcryptCost, bcryptHash, bcryptVerify } from "./bcrypt.ts";
import { crypto, encodeBase64 } from "../deps.ts";

export const PASSWORD_COST = 10;
export const PASSWORD_MIN_CHARS = 6;
export const PASSWORD_MAX_CHARS = 128;
const BCRYPT_MAX_BYTES = 72;

export class PasswordTooLong extends Error {
  constructor() {
    super("Password is too long");
  }
}

/** Why a new password can't be used, or null when it can. */
export function newPasswordError(password: string): string | null {
  const chars = [...password].length;
  if (chars < PASSWORD_MIN_CHARS) {
    return `Password must be at least ${PASSWORD_MIN_CHARS} characters`;
  }
  if (chars > PASSWORD_MAX_CHARS) return "Password is too long";
  return null;
}

async function sha3Base64(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return encodeBase64(
    new Uint8Array(await crypto.subtle.digest("SHA3-256", bytes)),
  );
}

/** What bcrypt is given: the password, or base64(SHA3-256) when over 72 bytes. */
export async function bcryptInput(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password);
  return bytes.length <= BCRYPT_MAX_BYTES ? password : await sha3Base64(bytes);
}

/** The bcrypt hash to store for password. */
export async function hashPassword(password: string): Promise<string> {
  if ([...password].length > PASSWORD_MAX_CHARS) throw new PasswordTooLong();
  return bcryptHash(await bcryptInput(password), PASSWORD_COST);
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
    const ok = bcryptVerify(await bcryptInput(password), stored);
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
