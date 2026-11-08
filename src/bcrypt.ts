// bcrypt (Provos & Mazières, 1999) in plain TypeScript: no npm packages.
// Produces $2b$ hashes; verifies $2a$, $2b$ and $2y$ (PHP), which are the
// same algorithm for passwords up to 72 bytes (longer ones are refused by
// password.ts). Checked against PHP's and Go's bcrypt in bcrypt_test.ts.

import { PI_WORDS } from "./bcrypt_pi.ts";

const B64 = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));
// "OrpheanBeholderScryDoubt", the text bcrypt encrypts.
const MAGIC = [
  0x4f727068,
  0x65616e42,
  0x65686f6c,
  0x64657253,
  0x63727944,
  0x6f756274,
];

function encode64(bytes: Uint8Array, length: number): string {
  let out = "";
  for (let i = 0; i < length;) {
    let c1 = bytes[i++];
    out += B64[c1 >> 2];
    c1 = (c1 & 0x03) << 4;
    if (i >= length) {
      out += B64[c1];
      break;
    }
    let c2 = bytes[i++];
    out += B64[c1 | (c2 >> 4)];
    c1 = (c2 & 0x0f) << 2;
    if (i >= length) {
      out += B64[c1];
      break;
    }
    c2 = bytes[i++];
    out += B64[c1 | (c2 >> 6)] + B64[c2 & 0x3f];
  }
  return out;
}

function decode64(text: string, length: number): Uint8Array | null {
  const out = new Uint8Array(length);
  const at = (i: number) => B64_INDEX.get(text[i]) ?? -1;
  let o = 0;
  for (let i = 0; o < length; i += 4) {
    const c1 = at(i), c2 = at(i + 1);
    if (c1 < 0 || c2 < 0) return null;
    out[o++] = (c1 << 2) | ((c2 & 0x30) >> 4);
    if (o >= length) break;
    const c3 = at(i + 2);
    if (c3 < 0) return null;
    out[o++] = ((c2 & 0x0f) << 4) | ((c3 & 0x3c) >> 2);
    if (o >= length) break;
    const c4 = at(i + 3);
    if (c4 < 0) return null;
    out[o++] = ((c3 & 0x03) << 6) | c4;
  }
  return out;
}

class Blowfish {
  P = new Uint32Array(PI_WORDS.slice(0, 18));
  S = new Uint32Array(PI_WORDS.slice(18));
  lr = new Uint32Array(2);

  private f(x: number): number {
    const S = this.S;
    return (((S[x >>> 24] + S[256 | ((x >>> 16) & 0xff)]) ^
      S[512 | ((x >>> 8) & 0xff)]) +
      S[768 | (x & 0xff)]) >>> 0;
  }

  /** Encrypt the block in this.lr in place. */
  encrypt(): void {
    const P = this.P;
    let l = this.lr[0], r = this.lr[1];
    for (let i = 0; i < 16; i += 2) {
      l ^= P[i];
      r ^= this.f(l);
      r ^= P[i + 1];
      l ^= this.f(r);
    }
    this.lr[0] = (r ^ P[17]) >>> 0;
    this.lr[1] = (l ^ P[16]) >>> 0;
  }

  /** Mix data into P and the S-boxes; with salt, XOR it into each block first. */
  expand(key: Uint8Array, salt?: Uint8Array): void {
    const word = (data: Uint8Array, pos: { i: number }) => {
      let w = 0;
      for (let j = 0; j < 4; j++) {
        w = (w << 8) | data[pos.i];
        pos.i = (pos.i + 1) % data.length;
      }
      return w >>> 0;
    };
    const kp = { i: 0 };
    for (let i = 0; i < 18; i++) this.P[i] = (this.P[i] ^ word(key, kp)) >>> 0;
    const sp = { i: 0 };
    this.lr[0] = 0;
    this.lr[1] = 0;
    const fill = (target: Uint32Array, n: number) => {
      for (let i = 0; i < n; i += 2) {
        if (salt) {
          this.lr[0] ^= word(salt, sp);
          this.lr[1] ^= word(salt, sp);
        }
        this.encrypt();
        target[i] = this.lr[0];
        target[i + 1] = this.lr[1];
      }
    };
    fill(this.P, 18);
    fill(this.S, 1024);
  }
}

/** The 23-byte bcrypt digest of key (NUL-terminated password) and salt. */
function crypt(key: Uint8Array, salt: Uint8Array, cost: number): Uint8Array {
  const bf = new Blowfish();
  bf.expand(key, salt);
  for (let i = 0, rounds = 2 ** cost; i < rounds; i++) {
    bf.expand(key);
    bf.expand(salt);
  }
  const text = Uint32Array.from(MAGIC);
  for (let j = 0; j < 6; j += 2) {
    bf.lr[0] = text[j];
    bf.lr[1] = text[j + 1];
    for (let i = 0; i < 64; i++) bf.encrypt();
    text[j] = bf.lr[0];
    text[j + 1] = bf.lr[1];
  }
  const out = new Uint8Array(24);
  for (let i = 0; i < 6; i++) {
    out[4 * i] = text[i] >>> 24;
    out[4 * i + 1] = text[i] >>> 16;
    out[4 * i + 2] = text[i] >>> 8;
    out[4 * i + 3] = text[i];
  }
  return out;
}

function keyBytes(password: string): Uint8Array {
  const pw = new TextEncoder().encode(password);
  const key = new Uint8Array(Math.min(pw.length + 1, 72)); // trailing NUL, at most 72 bytes
  key.set(pw.subarray(0, key.length));
  return key;
}

const HASH = /^\$2([aby])\$(\d\d)\$([./A-Za-z0-9]{22})([./A-Za-z0-9]{31})$/;

/** bcrypt hash of password with a random salt: "$2b$<cost>$<salt><digest>". */
export function bcryptHash(
  password: string,
  cost = 10,
  salt?: Uint8Array,
): string {
  if (!Number.isInteger(cost) || cost < 4 || cost > 31) {
    throw new Error("bcrypt cost must be 4..31");
  }
  salt ??= crypto.getRandomValues(new Uint8Array(16));
  const c = String(cost).padStart(2, "0");
  return `$2b$${c}$${encode64(salt, 16)}${
    encode64(crypt(keyBytes(password), salt, cost), 23)
  }`;
}

/** The cost of a bcrypt hash, or null when it isn't one. */
export function bcryptCost(hash: string): number | null {
  const m = HASH.exec(hash);
  return m ? Number(m[2]) : null;
}

/** Whether password matches a $2a$, $2b$ or $2y$ hash (constant-time compare). */
export function bcryptVerify(password: string, hash: string): boolean {
  const m = HASH.exec(hash);
  if (!m) return false;
  const cost = Number(m[2]);
  const salt = decode64(m[3], 16);
  if (!salt || cost < 4 || cost > 31) return false;
  const want = encode64(crypt(keyBytes(password), salt, cost), 23);
  let diff = 0;
  for (let i = 0; i < 31; i++) diff |= want.charCodeAt(i) ^ m[4].charCodeAt(i);
  return diff === 0;
}
