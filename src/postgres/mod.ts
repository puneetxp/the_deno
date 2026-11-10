// PostgreSQL client in plain TypeScript (Web APIs, Deno and std only).
//
// Files, from the top down:
//   pool.ts        pool.query(sql, params), as npm:pg's pool
//   connection.ts  one connection: connect, query, close
//   startup.ts     TLS, startup, password exchange (crypto in auth.ts)
//   query.ts       simple and extended queries, results, rows
//   values.ts      column values to JS values, parameters to text
//   socket.ts      message framing, read buffer, idle watch
//   protocol.ts    message codes, body reader and writer
//   errors.ts      PostgresError
export { Connection } from "./connection.ts";
export { PostgresError } from "./errors.ts";
export { createPool, Pool, type PoolOptions } from "./pool.ts";
export { encodeParam } from "./values.ts";
export type { ConnectOptions, FieldDef, QueryResult, Row } from "./types.ts";
