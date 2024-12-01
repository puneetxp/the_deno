import { crypto, encodeBase64 } from "../deps.ts";

export class hash {
  static async sha256(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return encodeBase64(hash);
  }
  static async sha512(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest("SHA-512", data);
    return encodeBase64(hash);
  }
  static async sha384(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest("SHA-384", data);
    return encodeBase64(hash);
  }
  static async sha3_256(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest("SHA3-256", data);
    return encodeBase64(hash);
  }
  static async sha3_512(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest("SHA3-512", data);
    return encodeBase64(hash);
  }
}
