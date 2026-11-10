// A connection pool with mysql2's pool.query(sql, values) behaviour. The
// pooling itself is shared with the PostgreSQL client (../conn_pool.ts).

import { ConnectionPool } from "../conn_pool.ts";
import { Connection } from "./connection.ts";
import { MySQLError } from "./errors.ts";
import { format } from "./format.ts";
import type { ConnectOptions } from "./types.ts";

export type PoolOptions = ConnectOptions & {
  /** Most connections open at once (default 10, as mysql2). */
  connectionLimit?: number;
};

export class Pool {
  #pool: ConnectionPool<Connection>;

  constructor(opts: PoolOptions) {
    this.#pool = new ConnectionPool({
      connect: () => Connection.connect(opts),
      limit: opts.connectionLimit ?? 10,
      closedError: () =>
        new MySQLError("pool is closed", { code: "POOL_CLOSED" }),
      isUnsent: (e) => e instanceof MySQLError && e.unsent,
    });
  }

  /** Format `?`/`??` placeholders, then run the SQL on a free connection. */
  query(sql: string, values?: unknown): Promise<[unknown, unknown]> {
    const text = format(sql, values);
    return this.#pool.use((c) => c.query(text));
  }

  /** Close every connection; queries still waiting for one are rejected. */
  end(): Promise<void> {
    return this.#pool.end();
  }
}

export function createPool(opts: PoolOptions): Pool {
  return new Pool(opts);
}
