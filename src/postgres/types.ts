// Types shared by the PostgreSQL client's files.

export type ConnectOptions = {
  /** Host name, or a Unix socket directory when it starts with "/". */
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  /** TLS for TCP connections: true, or Deno.startTls options. */
  tls?: boolean | { caCerts?: string[]; hostname?: string };
  /** Milliseconds for connect + startup (default 10000). */
  connectTimeout?: number;
  /**
   * Prepared statements kept per connection (default 256; 0 turns the cache
   * off). Needs a server that keeps sessions: not PgBouncer in transaction
   * pooling mode before 1.21.
   */
  statementCache?: number;
};

/** A column of a result, with npm:pg's field names. */
export type FieldDef = {
  name: string;
  tableID: number;
  columnID: number;
  dataTypeID: number;
  dataTypeSize: number;
  dataTypeModifier: number;
  format: "text" | "binary";
};

export type Row = Record<string, unknown>;

/** One statement's result, as npm:pg's Result. */
export type QueryResult = {
  /** INSERT, SELECT, UPDATE, ... or null for an empty query. */
  command: string | null;
  /** Rows affected or returned; null for commands that do not count. */
  rowCount: number | null;
  oid: number | null;
  rows: Row[];
  fields: FieldDef[];
};
