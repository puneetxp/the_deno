// A connection pool shared by the MySQL and PostgreSQL clients: up to
// `limit` connections, a queue for callers past it, closed connections
// dropped instead of reused, and one retry for a statement never sent.

/** What the pool needs from a connection. */
export interface PooledConnection {
  /** True once the connection can no longer be used. */
  readonly closed: boolean;
  close(): Promise<void>;
}

export type PoolSettings<C> = {
  /** Open and log in a new connection. */
  connect: () => Promise<C>;
  /** Most connections open at once. */
  limit: number;
  /** The error for calls made after end(). */
  closedError: () => Error;
  /** True when an error means the statement never reached the server. */
  isUnsent: (e: unknown) => boolean;
};

type Waiter<C> = {
  resolve: (c: C) => void;
  reject: (e: unknown) => void;
};

export class ConnectionPool<C extends PooledConnection> {
  #s: PoolSettings<C>;
  #idle: C[] = [];
  #open = new Set<C>();
  #connecting = 0;
  #waiters: Waiter<C>[] = [];
  #ended = false;

  constructor(settings: PoolSettings<C>) {
    this.#s = { ...settings, limit: Math.max(1, settings.limit) };
  }

  /**
   * Run fn on a free connection. If the connection turns out to be broken
   * before the statement went out, fn runs once more on another one; nothing
   * that may have reached the server is retried.
   */
  async use<T>(fn: (c: C) => Promise<T>): Promise<T> {
    for (let attempt = 0;; attempt++) {
      const conn = await this.#acquire();
      try {
        return await fn(conn);
      } catch (e) {
        if (attempt === 0 && this.#s.isUnsent(e)) continue;
        throw e;
      } finally {
        this.#release(conn);
      }
    }
  }

  #acquire(): Promise<C> {
    if (this.#ended) return Promise.reject(this.#s.closedError());
    while (this.#idle.length) {
      const c = this.#idle.pop()!;
      if (!c.closed) return Promise.resolve(c);
      this.#open.delete(c);
    }
    if (this.#open.size + this.#connecting < this.#s.limit) {
      return this.#create();
    }
    return new Promise((resolve, reject) =>
      this.#waiters.push({ resolve, reject })
    );
  }

  async #create(): Promise<C> {
    this.#connecting++;
    try {
      const c = await this.#s.connect();
      this.#open.add(c);
      return c;
    } catch (e) {
      // This slot is free again; let the next waiter try its own connection.
      this.#openForWaiter();
      throw e;
    } finally {
      this.#connecting--;
    }
  }

  /** A slot is free: open a connection for the next waiter, if any. */
  #openForWaiter() {
    const w = this.#ended ? undefined : this.#waiters.shift();
    if (w) queueMicrotask(() => this.#create().then(w.resolve, w.reject));
  }

  #release(c: C) {
    if (this.#ended || c.closed) {
      this.#open.delete(c);
      if (!c.closed) c.close().catch(() => {});
      this.#openForWaiter();
      return;
    }
    const w = this.#waiters.shift();
    if (w) w.resolve(c);
    else this.#idle.push(c);
  }

  /** Close every idle connection (busy ones close when released). */
  async end(): Promise<void> {
    this.#ended = true;
    for (const w of this.#waiters.splice(0)) w.reject(this.#s.closedError());
    const idle = this.#idle.splice(0);
    for (const c of idle) this.#open.delete(c);
    await Promise.all(idle.map((c) => c.close()));
  }
}
