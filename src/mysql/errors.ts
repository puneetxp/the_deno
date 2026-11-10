// Errors from the server or the connection, with mysql2's field names.

import { dec, Reader } from "./protocol.ts";

const ERROR_CODES: Record<number, string> = {
  1045: "ER_ACCESS_DENIED_ERROR",
  1048: "ER_BAD_NULL_ERROR",
  1049: "ER_BAD_DB_ERROR",
  1053: "ER_SERVER_SHUTDOWN",
  1054: "ER_BAD_FIELD_ERROR",
  1062: "ER_DUP_ENTRY",
  1064: "ER_PARSE_ERROR",
  1146: "ER_NO_SUCH_TABLE",
  1153: "ER_NET_PACKET_TOO_LARGE",
  1205: "ER_LOCK_WAIT_TIMEOUT",
  1213: "ER_LOCK_DEADLOCK",
  1264: "ER_WARN_DATA_OUT_OF_RANGE",
  1364: "ER_NO_DEFAULT_FOR_FIELD",
  1366: "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD",
  1406: "ER_DATA_TOO_LONG",
  1451: "ER_ROW_IS_REFERENCED_2",
  1452: "ER_NO_REFERENCED_ROW_2",
  1927: "ER_CONNECTION_KILLED",
  4031: "ER_CLIENT_INTERACTION_TIMEOUT",
};

export type MySQLErrorOptions = {
  errno?: number;
  sqlState?: string;
  fatal?: boolean;
  code?: string;
  unsent?: boolean;
};

/**
 * An error from the server (it has errno and sqlState; the connection stays
 * usable) or from the connection (fatal; the connection is closed).
 */
export class MySQLError extends Error {
  code: string;
  errno?: number;
  sqlState?: string;
  sqlMessage?: string;
  fatal: boolean;
  /** True when the statement was never sent, so it is safe to retry. */
  unsent: boolean;

  constructor(message: string, opts: MySQLErrorOptions = {}) {
    super(message);
    this.name = "MySQLError";
    this.errno = opts.errno;
    this.sqlState = opts.sqlState;
    this.sqlMessage = opts.errno !== undefined ? message : undefined;
    this.fatal = opts.fatal ?? false;
    this.unsent = opts.unsent ?? false;
    this.code = opts.code ??
      (opts.errno !== undefined
        ? ERROR_CODES[opts.errno] ?? `ER_${opts.errno}`
        : "PROTOCOL_ERROR");
  }
}

/** A fatal protocol error (bad packet, unsupported feature). */
export function protocolError(message: string): MySQLError {
  return new MySQLError(message, { fatal: true });
}

/** The connection is gone (closed, reset, timed out). */
export function connectionLost(
  why: string,
  extra: { unsent?: boolean } = {},
): MySQLError {
  return new MySQLError(`connection lost: ${why}`, {
    fatal: true,
    code: "PROTOCOL_CONNECTION_LOST",
    ...extra,
  });
}

/** The error in an ERR packet (0xff, errno, '#' + SQLSTATE, message). */
export function serverError(p: Uint8Array): MySQLError {
  const r = new Reader(p);
  r.u8(); // 0xff
  const errno = r.u16();
  let sqlState: string | undefined;
  if (r.buf[r.pos] === 0x23) { // '#'
    r.u8();
    sqlState = dec.decode(r.bytes(5));
  }
  return new MySQLError(dec.decode(r.rest()), { errno, sqlState });
}

/** True for an error the server sent, after which the connection is fine. */
export function isServerError(e: unknown): e is MySQLError {
  return e instanceof MySQLError && e.errno !== undefined;
}
