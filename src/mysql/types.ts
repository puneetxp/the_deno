// Types shared by the MySQL/MariaDB client's files.

export type ConnectOptions = {
  host?: string;
  port?: number;
  /** Unix socket path; used instead of host/port when set. */
  socketPath?: string;
  user?: string;
  password?: string;
  database?: string;
  /** TLS for TCP connections: true, or Deno.startTls options. */
  tls?: boolean | { caCerts?: string[]; hostname?: string };
  /** Milliseconds for connect + login (default 10000, as mysql2). */
  connectTimeout?: number;
};

/** A column of a result, as the server describes it. */
export type Field = {
  db: string;
  table: string;
  orgTable: string;
  name: string;
  orgName: string;
  characterSet: number;
  columnLength: number;
  columnType: number;
  type: number;
  flags: number;
  decimals: number;
};

/** What a statement without rows returns (same fields as mysql2). */
export type ResultSetHeader = {
  fieldCount: 0;
  affectedRows: number;
  insertId: number;
  info: string;
  serverStatus: number;
  warningStatus: number;
  changedRows: number;
};

export type Row = Record<string, unknown>;
