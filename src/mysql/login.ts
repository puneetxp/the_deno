// Connection phase: the server's greeting, optional TLS, and the login
// exchange for each supported auth plugin.

import {
  cachingSha2Password,
  clearPassword,
  nativePassword,
  rsaEncryptPassword,
} from "./auth.ts";
import { protocolError, serverError } from "./errors.ts";
import {
  CONNECT_WITH_DB,
  dec,
  FOUND_ROWS,
  LONG_FLAG,
  LONG_PASSWORD,
  MAX_PACKET,
  MULTI_RESULTS,
  PLUGIN_AUTH,
  PLUGIN_AUTH_LENENC,
  PROTOCOL_41,
  Reader,
  SECURE_CONNECTION,
  SSL,
  TRANSACTIONS,
  UTF8MB4_UNICODE_CI,
  Writer,
} from "./protocol.ts";
import type { PacketSocket } from "./socket.ts";
import type { ConnectOptions } from "./types.ts";

export type ServerInfo = { serverVersion: string; threadId: number };

type Greeting = ServerInfo & {
  caps: number;
  plugin: string;
  scramble: Uint8Array;
};

/** Without a trailing NUL, which some servers add to the scramble. */
function trimNul(b: Uint8Array): Uint8Array {
  return b[b.length - 1] === 0 ? b.subarray(0, b.length - 1) : b;
}

/** The initial handshake packet (protocol version 10). */
function parseGreeting(p: Uint8Array): Greeting {
  if (p[0] === 0xff) throw serverError(p);
  const r = new Reader(p);
  if (r.u8() !== 10) throw protocolError("unsupported handshake protocol");
  const serverVersion = r.nulStr();
  const threadId = r.u32();
  const part1 = r.bytes(8);
  r.u8(); // filler
  let caps = r.u16();
  let part2: Uint8Array = new Uint8Array(0);
  let plugin = "mysql_native_password";
  if (!r.done) {
    r.u8(); // charset
    r.u16(); // status
    caps |= r.u16() << 16;
    const authLen = r.u8();
    r.bytes(10); // reserved (MariaDB extended caps)
    if (caps & SECURE_CONNECTION) {
      part2 = r.bytes(Math.max(13, authLen - 8));
    }
    if (caps & PLUGIN_AUTH) plugin = r.nulStr();
  }
  const scramble = new Uint8Array(part1.length + part2.length);
  scramble.set(part1);
  scramble.set(part2, part1.length);
  return { serverVersion, threadId, caps, plugin, scramble: trimNul(scramble) };
}

/** The first answer for a plugin, from the password and the scramble. */
async function authResponse(
  plugin: string,
  password: string,
  scramble: Uint8Array,
  secure: boolean,
): Promise<Uint8Array> {
  switch (plugin) {
    case "mysql_native_password":
      return await nativePassword(password, scramble);
    case "caching_sha2_password":
      return await cachingSha2Password(password, scramble);
    case "sha256_password":
      if (!password) return Uint8Array.of(0);
      // Without TLS, ask for the server's RSA key (1) and encrypt with it.
      return secure ? clearPassword(password) : Uint8Array.of(1);
    case "mysql_clear_password":
      if (!secure) {
        throw protocolError(
          "the server asked for the clear-text password over an unencrypted connection; use TLS or a socket",
        );
      }
      return clearPassword(password);
    default:
      throw protocolError(`unsupported login plugin: ${plugin}`);
  }
}

/** Log in on a fresh socket. Throws the server's error if it refuses. */
export async function login(
  socket: PacketSocket,
  opts: ConnectOptions,
): Promise<ServerInfo> {
  const hello = parseGreeting(await socket.readPacket());
  if (!(hello.caps & PROTOCOL_41)) {
    throw protocolError("server is too old (no protocol 4.1)");
  }

  let caps = LONG_PASSWORD | FOUND_ROWS | LONG_FLAG | PROTOCOL_41 |
    TRANSACTIONS | SECURE_CONNECTION | MULTI_RESULTS | PLUGIN_AUTH |
    PLUGIN_AUTH_LENENC;
  if (opts.database) caps |= CONNECT_WITH_DB;
  caps &= hello.caps | CONNECT_WITH_DB;

  // Both the TLS request and the login start with these 32 bytes.
  const prefix = () =>
    new Writer().u32(caps).u32(MAX_PACKET).u8(UTF8MB4_UNICODE_CI).zeros(23);

  if (opts.tls && !opts.socketPath) {
    if (!(hello.caps & SSL)) {
      throw protocolError("the server does not support TLS");
    }
    caps |= SSL;
    await socket.writePacket(prefix().done());
    const tls = typeof opts.tls === "object" ? opts.tls : {};
    await socket.startTls(
      tls.hostname ?? opts.host ?? "localhost",
      tls.caCerts,
    );
  }

  const password = opts.password ?? "";
  let plugin = hello.plugin;
  let scramble = hello.scramble;
  const first = await authResponse(plugin, password, scramble, socket.secure);
  const w = prefix().nul(opts.user ?? "");
  if (caps & PLUGIN_AUTH_LENENC) w.lenenc(first.length).bytes(first);
  else w.u8(first.length).bytes(first);
  if (caps & CONNECT_WITH_DB) w.nul(opts.database!);
  if (caps & PLUGIN_AUTH) w.nul(plugin);
  await socket.writePacket(w.done());

  while (true) {
    const p = await socket.readPacket();
    if (p[0] === 0x00) {
      return { serverVersion: hello.serverVersion, threadId: hello.threadId };
    }
    if (p[0] === 0xff) throw serverError(p);

    if (p[0] === 0xfe) {
      // Auth switch: the server wants another plugin.
      const r = new Reader(p);
      r.u8();
      if (r.done) {
        throw protocolError(
          "the server asked for the old (pre-4.1) password scheme, which is not supported",
        );
      }
      plugin = r.nulStr();
      scramble = trimNul(r.rest().slice());
      await socket.writePacket(
        await authResponse(plugin, password, scramble, socket.secure),
      );
      continue;
    }

    if (p[0] === 0x01) {
      // More data for the current plugin.
      const data = p.subarray(1);
      if (plugin === "caching_sha2_password" && data.length === 1) {
        if (data[0] === 3) continue; // fast login done; OK follows
        if (data[0] === 4) {
          // Full login: the password itself, in the clear only when safe.
          await socket.writePacket(
            socket.secure ? clearPassword(password) : Uint8Array.of(2), // 2: send the RSA key
          );
          continue;
        }
      }
      if (plugin === "caching_sha2_password" || plugin === "sha256_password") {
        const pem = dec.decode(data); // the server's RSA public key
        await socket.writePacket(
          await rsaEncryptPassword(password, scramble, pem),
        );
        continue;
      }
    }
    throw protocolError(`unexpected packet during login (plugin ${plugin})`);
  }
}
