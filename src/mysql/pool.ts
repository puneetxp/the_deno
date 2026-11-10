// A connection pool with mysql2's pool.query(sql, values) behaviour.

import { Connection } from "./connection.ts";
import { MySQLError } from "./errors.ts";
import type { ConnectOptions } from "./types.ts";
import { format } from "./format.ts";

export type PoolOptions = ConnectOptions & {
  /** Most connections open at once (default 10, as mysql2). */
  connectionLimit?: number;
};

type Waiter = {
  resolve: (c: Connection) => void;
  reject: (e: unknown) => void;
};

export class Pool {
  #opts: PoolOptions;
  #limit: number;
  #idle: Connection[] = [];
  #open = new Set<Connection>();
  #connecting = 0;
  #waiters: Waiter[] = [];
  #ended = false;

  constructor(opts: PoolOptions) {
    this.#opts = opts;
    this.#limit = Math.max(1, opts.connectionLimit ?? 10);
  }

  /** Format `?`/`??` placeholders, then run the SQL on a free connection. */
  async query(sql: string, values?: unknown): Promise<[unknown, unknown]> {
    const text = format(sql, values);
    for (let attempt = 0;; attempt++) {
      const conn = await this.#acquire();
      try {
        return await conn.query(text);
      } catch (e) {
        // A connection found broken before the statement went out: retry once
        // on another. Anything that may have reached the server is not retried.
        if (attempt === 0 && e instanceof MySQLError && e.unsent) continue;
        throw e;
      } finally {
        this.#release(conn);
      }
    }
  }

  #acquire(): Promise<Connection> {
    if (this.#ended) {
      return Promise.reject(
        new MySQLError("pool is closed", { code: "POOL_CLOSED" }),
      );
    }
    while (this.#idle.length) {
      const c = this.#idle.pop()!;
      if (!c.closed) return Promise.resolve(c);
      this.#open.delete(c);
    }
    if (this.#open.size + this.#connecting < this.#limit) return this.#create();
    return new Promise((resolve, reject) =>
      this.#waiters.push({ resolve, reject })
    );
  }

  async #create(): Promise<Connection> {
    this.#connecting++;
    try {
      const c = await Connection.connect(this.#opts);
      this.#open.add(c);
      return c;
    } catch (e) {
      // This slot is free again; let the next waiter try its own connection.
      const w = this.#ended ? undefined : this.#waiters.shift();
      if (w) queueMicrotask(() => this.#create().then(w.resolve, w.reject));
      throw e;
    } finally {
      this.#connecting--;
    }
  }

  #release(c: Connection) {
    if (this.#ended || c.closed) {
      this.#open.delete(c);
      if (!c.closed) c.close();
      // A slot is free: open a connection for the next waiter, if any.
      const w = this.#ended ? undefined : this.#waiters.shift();
      if (w) this.#create().then(w.resolve, w.reject);
      return;
    }
    const w = this.#waiters.shift();
    if (w) w.resolve(c);
    else this.#idle.push(c);
  }

  /** Close every connection; queries still waiting for one are rejected. */
  async end(): Promise<void> {
    this.#ended = true;
    const err = new MySQLError("pool is closed", { code: "POOL_CLOSED" });
    for (const w of this.#waiters.splice(0)) w.reject(err);
    const idle = this.#idle.splice(0);
    for (const c of idle) this.#open.delete(c);
    await Promise.all(idle.map((c) => c.close()));
  }
}

export function createPool(opts: PoolOptions): Pool {
  return new Pool(opts);
}
