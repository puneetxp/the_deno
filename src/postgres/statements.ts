// A per-connection cache of prepared statements, as pgx keeps by default.
//
// The first run of a SQL text prepares it under a name and remembers its
// columns; later runs send only Bind/Execute, so the server skips parsing and
// planning, and nothing is described again. Least recently used statements
// are closed when the cache is full.

import type { FieldDef } from "./types.ts";
import { type Decode, decoder } from "./values.ts";

/** A prepared statement and how to read its rows. */
export type Prepared = {
  name: string;
  fields: FieldDef[];
  names: string[];
  decoders: Decode[];
};

// Names must not clash with other sessions' statements: PGlite, for one,
// shares one backend between connections.
let session = 0;

export class StatementCache {
  #byText = new Map<string, Prepared>();
  #toClose: string[] = [];
  #prefix = `the_${Date.now().toString(36)}_${(session++).toString(36)}_`;
  #next = 0;

  constructor(readonly size = 256) {}

  /** The statement for this text, marking it most recently used. */
  get(sql: string): Prepared | undefined {
    const p = this.#byText.get(sql);
    if (p) {
      this.#byText.delete(sql);
      this.#byText.set(sql, p);
    }
    return p;
  }

  /** A fresh name for a statement about to be prepared. */
  newName(): string {
    return this.#prefix + (this.#next++).toString(36);
  }

  /** Remember a statement the server has prepared. */
  add(sql: string, name: string, fields: FieldDef[]): void {
    this.#byText.set(sql, {
      name,
      fields,
      names: fields.map((f) => f.name),
      decoders: fields.map((f) => decoder(f.dataTypeID)),
    });
    while (this.#byText.size > this.size) {
      const [oldest, p] = this.#byText.entries().next().value!;
      this.#byText.delete(oldest);
      this.#toClose.push(p.name);
    }
  }

  /** Forget a statement (the server lost it, or its result shape changed). */
  drop(sql: string): void {
    const p = this.#byText.get(sql);
    if (!p) return;
    this.#byText.delete(sql);
    this.#toClose.push(p.name);
  }

  /** Close a statement on the server with the next one sent. */
  closeLater(name: string): void {
    this.#toClose.push(name);
  }

  /** Names to close on the server; sent ahead of the next statement. */
  takeClosed(): string[] {
    return this.#toClose.splice(0);
  }
}
