// Deno KV Cache for Model tables
let kv: Deno.Kv | null = null;

async function getKV(): Promise<Deno.Kv> {
  if (!kv) {
    kv = await Deno.openKv();
  }
  return kv;
}

export class KVCache {
  private prefix = "cache";

  constructor(private table: string) {}

  private key(suffix?: string): Deno.KvKey {
    return suffix
      ? [this.prefix, this.table, suffix]
      : [this.prefix, this.table, "all"];
  }

  async getAll<T>(): Promise<T[] | null> {
    const db = await getKV();
    const result = await db.get<T[]>(this.key());
    return result.value;
  }

  async setAll<T>(data: T[], expireIn?: number): Promise<void> {
    const db = await getKV();
    const options = expireIn ? { expireIn } : {};
    await db.set(this.key(), data, options);
  }

  async get<T>(id: string | number): Promise<T | null> {
    const db = await getKV();
    const result = await db.get<T>(this.key(String(id)));
    return result.value;
  }

  async set<T>(id: string | number, data: T, expireIn?: number): Promise<void> {
    const db = await getKV();
    const options = expireIn ? { expireIn } : {};
    await db.set(this.key(String(id)), data, options);
  }

  async invalidate(): Promise<void> {
    const db = await getKV();
    const entries = db.list({ prefix: [this.prefix, this.table] });
    for await (const entry of entries) {
      await db.delete(entry.key);
    }
  }

  async invalidateOne(id: string | number): Promise<void> {
    const db = await getKV();
    await db.delete(this.key(String(id)));
    // Also invalidate "all" cache since it's now stale
    await db.delete(this.key());
  }
}

export function createCache(table: string): KVCache {
  return new KVCache(table);
}
