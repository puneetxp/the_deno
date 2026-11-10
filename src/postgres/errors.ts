// Errors from the server (ErrorResponse fields, as npm:pg names them) or from
// the connection.

import { dec } from "./protocol.ts";

/** ErrorResponse/NoticeResponse field codes, by the name pg uses. */
const FIELDS: Record<string, string> = {
  V: "severity", // non-localized; S (localized) is used if V is missing
  C: "code",
  M: "message",
  D: "detail",
  H: "hint",
  P: "position",
  p: "internalPosition",
  q: "internalQuery",
  W: "where",
  s: "schema",
  t: "table",
  c: "column",
  d: "dataType",
  n: "constraint",
  F: "file",
  L: "line",
  R: "routine",
};

/**
 * An error. From the server it has a SQLSTATE `code` (e.g. 23505 for a
 * unique violation) and the connection stays usable; otherwise it is
 * `fatal` and the connection is closed.
 */
export class PostgresError extends Error {
  severity?: string;
  code?: string;
  detail?: string;
  hint?: string;
  position?: string;
  internalPosition?: string;
  internalQuery?: string;
  where?: string;
  schema?: string;
  table?: string;
  column?: string;
  dataType?: string;
  constraint?: string;
  file?: string;
  line?: string;
  routine?: string;
  /** True when the connection can no longer be used. */
  fatal: boolean;
  /** True when the statement was never sent, so it is safe to retry. */
  unsent: boolean;

  constructor(
    message: string,
    opts: { fatal?: boolean; unsent?: boolean } = {},
  ) {
    super(message);
    this.name = "PostgresError";
    this.fatal = opts.fatal ?? false;
    this.unsent = opts.unsent ?? false;
  }
}

/** The fields of an ErrorResponse or NoticeResponse body. */
export function parseFields(body: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < body.length && body[pos] !== 0) {
    const code = String.fromCharCode(body[pos]);
    let end = body.indexOf(0, pos + 1);
    if (end < 0) end = body.length;
    out[code] = dec.decode(body.subarray(pos + 1, end));
    pos = end + 1;
  }
  return out;
}

/** The error in an ErrorResponse body. */
export function serverError(body: Uint8Array): PostgresError {
  const f = parseFields(body);
  const err = new PostgresError(f.M ?? "unknown server error");
  const fields = err as unknown as Record<string, string>;
  for (const [code, name] of Object.entries(FIELDS)) {
    if (f[code] !== undefined && name !== "message") fields[name] = f[code];
  }
  err.severity ??= f.S;
  // FATAL and PANIC end the session.
  err.fatal = err.severity === "FATAL" || err.severity === "PANIC";
  return err;
}

/** A fatal protocol error (bad message, unsupported feature). */
export function protocolError(message: string): PostgresError {
  return new PostgresError(message, { fatal: true });
}

/** The connection is gone (closed, reset, timed out). */
export function connectionLost(
  why: string,
  extra: { unsent?: boolean } = {},
): PostgresError {
  return new PostgresError(`connection lost: ${why}`, {
    fatal: true,
    ...extra,
  });
}

/** True for an error the server sent, after which the connection is fine. */
export function isServerError(e: unknown): e is PostgresError {
  return e instanceof PostgresError && e.code !== undefined && !e.fatal;
}
