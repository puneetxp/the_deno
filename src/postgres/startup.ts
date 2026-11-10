// Connection start-up: optional TLS, the startup message, the password
// exchange (clear text, MD5 or SCRAM-SHA-256), then the server's settings
// until the first ReadyForQuery.

import { md5Password, Scram } from "./auth.ts";
import { protocolError, serverError } from "./errors.ts";
import {
  B,
  dec,
  F,
  PROTOCOL_3,
  Reader,
  SSL_REQUEST,
  Writer,
} from "./protocol.ts";
import type { MessageSocket } from "./socket.ts";
import type { ConnectOptions } from "./types.ts";

/** What the server told us during start-up. */
export type ServerInfo = {
  /** ParameterStatus values: server_version, TimeZone, ... */
  parameters: Record<string, string>;
  processId: number;
  secretKey: number;
};

// Authentication request codes (the first field of an 'R' message).
const AUTH_OK = 0;
const AUTH_CLEARTEXT = 3;
const AUTH_MD5 = 5;
const AUTH_SASL = 10;
const AUTH_SASL_CONTINUE = 11;
const AUTH_SASL_FINAL = 12;

function passwordMessage(data: string | Uint8Array): Uint8Array {
  const w = new Writer().start(F.Password);
  return (typeof data === "string" ? w.cstr(data) : w.bytes(data)).done();
}

/** Ask for TLS before the startup message; the server answers 'S' or 'N'. */
async function upgradeTls(socket: MessageSocket, opts: ConnectOptions) {
  await socket.write(new Writer().start(0).i32(SSL_REQUEST).done());
  const answer = await socket.readByte();
  if (answer !== 0x53) { // 'S'
    throw protocolError("the server does not support TLS");
  }
  const tls = typeof opts.tls === "object" ? opts.tls : {};
  await socket.startTls(tls.hostname ?? opts.host ?? "localhost", tls.caCerts);
}

/** Start a session on a fresh socket. Throws the server's error if refused. */
export async function startup(
  socket: MessageSocket,
  opts: ConnectOptions,
  isUnixSocket: boolean,
): Promise<ServerInfo> {
  if (opts.tls && !isUnixSocket) await upgradeTls(socket, opts);

  const user = opts.user ?? "";
  const password = opts.password ?? "";
  const w = new Writer().start(0).i32(PROTOCOL_3)
    .cstr("user").cstr(user)
    .cstr("database").cstr(opts.database || user)
    .cstr("client_encoding").cstr("UTF8");
  await socket.write(w.u8(0).done());

  const info: ServerInfo = { parameters: {}, processId: 0, secretKey: 0 };
  let scram: Scram | null = null;

  while (true) {
    const body = await socket.readMessage();
    switch (socket.type) {
      case B.Authentication: {
        const r = new Reader(body);
        const code = r.i32();
        if (code === AUTH_OK) break;
        if (code === AUTH_CLEARTEXT) {
          await socket.write(passwordMessage(password));
        } else if (code === AUTH_MD5) {
          await socket.write(
            passwordMessage(await md5Password(user, password, r.bytes(4))),
          );
        } else if (code === AUTH_SASL) {
          const mechanisms: string[] = [];
          while (!r.done && r.buf[r.pos] !== 0) mechanisms.push(r.cstr());
          if (!mechanisms.includes("SCRAM-SHA-256")) {
            throw protocolError(
              `unsupported SASL mechanisms: ${mechanisms.join(", ")}`,
            );
          }
          scram = new Scram(password);
          const first = new TextEncoder().encode(scram.first());
          await socket.write(
            new Writer().start(F.Password).cstr("SCRAM-SHA-256")
              .i32(first.length).bytes(first).done(),
          );
        } else if (code === AUTH_SASL_CONTINUE) {
          if (!scram) throw protocolError("SASL continue before start");
          const final = await scram.final(dec.decode(r.rest()));
          await socket.write(passwordMessage(new TextEncoder().encode(final)));
        } else if (code === AUTH_SASL_FINAL) {
          if (!scram) throw protocolError("SASL final before start");
          scram.verify(dec.decode(r.rest()));
        } else {
          throw protocolError(`unsupported authentication method ${code}`);
        }
        break;
      }
      case B.ParameterStatus: {
        const r = new Reader(body);
        info.parameters[r.cstr()] = r.cstr();
        break;
      }
      case B.BackendKeyData: {
        const r = new Reader(body);
        info.processId = r.i32();
        info.secretKey = r.i32();
        break;
      }
      case B.ReadyForQuery:
        return info;
      case B.ErrorResponse:
        throw serverError(body);
      case B.NoticeResponse:
        break;
      default:
        throw protocolError(
          `unexpected message ${String.fromCharCode(socket.type)} at startup`,
        );
    }
  }
}
