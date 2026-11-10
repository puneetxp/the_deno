// Password scrambles for the MySQL/MariaDB login plugins, with Web Crypto.

const enc = new TextEncoder();

async function digest(alg: "SHA-1" | "SHA-256", ...parts: Uint8Array[]) {
  let len = 0;
  for (const p of parts) len += p.length;
  const buf = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return new Uint8Array(await crypto.subtle.digest(alg, buf));
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i % b.length];
  return out;
}

/** mysql_native_password: SHA1(pw) XOR SHA1(scramble + SHA1(SHA1(pw))). */
export async function nativePassword(
  password: string,
  scramble: Uint8Array,
): Promise<Uint8Array> {
  if (!password) return new Uint8Array(0);
  const h1 = await digest("SHA-1", enc.encode(password));
  const h2 = await digest("SHA-1", h1);
  const h3 = await digest("SHA-1", scramble.subarray(0, 20), h2);
  return xor(h1, h3);
}

/** caching_sha2_password fast path: SHA256(pw) XOR SHA256(SHA256(SHA256(pw)) + scramble). */
export async function cachingSha2Password(
  password: string,
  scramble: Uint8Array,
): Promise<Uint8Array> {
  if (!password) return new Uint8Array(0);
  const h1 = await digest("SHA-256", enc.encode(password));
  const h2 = await digest("SHA-256", h1);
  const h3 = await digest("SHA-256", h2, scramble.subarray(0, 20));
  return xor(h1, h3);
}

/** The password, NUL-terminated (clear text; only over TLS or a local socket). */
export function clearPassword(password: string): Uint8Array<ArrayBuffer> {
  const pw = enc.encode(password);
  const out = new Uint8Array(pw.length + 1);
  out.set(pw);
  return out;
}

/**
 * caching_sha2_password full login without TLS: the NUL-terminated password,
 * XORed with the scramble, encrypted with the server's RSA key (OAEP, SHA-1).
 */
export async function rsaEncryptPassword(
  password: string,
  scramble: Uint8Array,
  pem: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "spki",
    der,
    { name: "RSA-OAEP", hash: "SHA-1" },
    false,
    ["encrypt"],
  );
  const plain = xor(clearPassword(password), scramble.subarray(0, 20));
  return new Uint8Array(
    await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, plain),
  );
}
