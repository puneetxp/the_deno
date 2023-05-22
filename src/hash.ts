import { crypto } from "https://deno.land/std@0.188.0/crypto/mod.ts";
import { encode } from "https://deno.land/std@0.188.0/encoding/base64.ts";

export class hash {
  static async sha256(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return encode(hash);
  }
  static async sha512(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest("SHA-512", data);
    return encode(hash);
  }
  static async sha384(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest("SHA-384", data);
    return encode(hash);
  }
  static async sha3_256(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest("SHA3-256", data);
    return encode(hash);
  }
  static async sha3_512(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest("SHA3-512", data);
    return encode(hash);
  }
}
