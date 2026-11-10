// A connection pool with npm:pg's pool.query(sql, params) behaviour. The
// pooling itself is shared with the MySQL client (../conn_pool.ts).

import { ConnectionPool } from "../conn_pool.ts";
import { Connection } from "./connection.ts";
import { PostgresError } from "./errors.ts";
import type { ConnectOptions, QueryResult } from "./types.ts";

export type PoolOptions = ConnectOptions & {
  /** Most connections open at once (default 10, as pg). */
  max?: number;
};

export class Pool {
  #pool: ConnectionPool<Connection>;

  constructor(opts: PoolOptions) {
    this.#pool = new ConnectionPool({
      connect: () => Connection.connect(opts),
      limit: opts.max ?? 10,
      closedError: () => new PostgresError("pool is closed"),
      isUnsent: (e) => e instanceof PostgresError && e.unsent,
    });
  }

  /**
   * Run SQL on a free connection. One statement gives one result; text with
   * several statements (no parameters) gives an array, as in pg.
   */
  async query(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult | QueryResult[]> {
    const results = await this.#pool.use((c) => c.query(sql, params));
    return results.length === 1 ? results[0] : results;
  }

  /** Close every connection; queries still waiting for one are rejected. */
  end(): Promise<void> {
    return this.#pool.end();
  }
}

export function createPool(opts: PoolOptions): Pool {
  return new Pool(opts);
}
