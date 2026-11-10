// MySQL/MariaDB client in plain TypeScript (Web APIs and Deno only).
//
// Files, from the top down:
//   pool.ts        pool.query(sql, values), as mysql2's pool
//   format.ts      ? and ?? placeholders, value escaping
//   connection.ts  one connection: connect, query, close
//   login.ts       greeting, TLS, auth plugins (crypto in auth.ts)
//   results.ts     OK packets, result sets, rows
//   values.ts      column values to JS values (the hot path)
//   socket.ts      packet framing, read buffer, idle watch
//   protocol.ts    constants, payload reader and writer
//   errors.ts      MySQLError
export { Connection } from "./connection.ts";
export { MySQLError } from "./errors.ts";
export { createPool, Pool, type PoolOptions } from "./pool.ts";
export { escape, escapeId, format, raw, type RawSQL } from "./format.ts";
export type { ConnectOptions, Field, ResultSetHeader, Row } from "./types.ts";
