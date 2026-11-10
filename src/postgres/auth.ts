// Password logins: MD5 and SCRAM-SHA-256 (RFC 5802 / RFC 7677).
// SHA-256, HMAC and PBKDF2 come from Web Crypto; MD5 from Deno's std.

import { crypto as stdCrypto } from "../../deps.ts";
import { enc } from "./protocol.ts";

const toHex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function md5Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(new Uint8Array(await stdCrypto.subtle.digest("MD5", data)));
}

/** md5 login: "md5" + md5(md5(password + user) + salt), in hex. */
export async function md5Password(
  user: string,
  password: string,
  salt: Uint8Array,
): Promise<string> {
  const inner = await md5Hex(enc.encode(password + user));
  const outer = enc.encode(inner);
  const salted = new Uint8Array(outer.length + salt.length);
  salted.set(outer);
  salted.set(salt, outer.length);
  return "md5" + await md5Hex(salted);
}

// ---- SCRAM-SHA-256 -----------------------------------------------------

function b64(b: Uint8Array): string {
  return btoa(String.fromCharCode(...b));
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

/** The attributes of a SCRAM message ("r=...,s=...,i=..."). */
function attributes(msg: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of msg.split(",")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

/**
 * One SCRAM-SHA-256 exchange, without channel binding:
 * first() → server-first → final(server-first) → server-final → verify().
 */
export class Scram {
  readonly #password: string;
  readonly #nonce: string;
  #authMessage = "";
  #serverSignature = "";

  /** `nonce` is for tests; by default it is 18 random bytes. */
  constructor(password: string, nonce?: string) {
    this.#password = password;
    this.#nonce = nonce ?? b64(crypto.getRandomValues(new Uint8Array(18)));
  }

  /** client-first-message-bare; the user name is taken from the startup. */
  get firstBare(): string {
    return `n=*,r=${this.#nonce}`;
  }

  /** client-first-message (no channel binding: "n,,"). */
  first(): string {
    return "n,," + this.firstBare;
  }

  /** client-final-message, with the proof, for the server's first message. */
  async final(
    serverFirst: string,
    firstBare = this.firstBare,
  ): Promise<string> {
    const a = attributes(serverFirst);
    if (!a.r?.startsWith(this.#nonce) || a.r.length === this.#nonce.length) {
      throw new Error("SCRAM: the server nonce does not extend ours");
    }
    const iterations = Number(a.i);
    if (!a.s || !(iterations > 0)) throw new Error("SCRAM: bad server message");

    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(this.#password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const salted = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: unb64(a.s), iterations },
        key,
        256,
      ),
    );
    const clientKey = await hmac(salted, "Client Key");
    const storedKey = new Uint8Array(
      await crypto.subtle.digest("SHA-256", clientKey),
    );
    const withoutProof = `c=biws,r=${a.r}`; // biws = base64("n,,")
    this.#authMessage = `${firstBare},${serverFirst},${withoutProof}`;
    const signature = await hmac(storedKey, this.#authMessage);
    const proof = clientKey.map((b, i) => b ^ signature[i]);
    const serverKey = await hmac(salted, "Server Key");
    this.#serverSignature = b64(await hmac(serverKey, this.#authMessage));
    return `${withoutProof},p=${b64(proof)}`;
  }

  /** Check the server's final message, which proves it knows the password. */
  verify(serverFinal: string): void {
    const a = attributes(serverFinal);
    if (a.e) throw new Error(`SCRAM: the server said ${a.e}`);
    if (a.v !== this.#serverSignature) {
      throw new Error("SCRAM: the server's signature does not match");
    }
  }
}
