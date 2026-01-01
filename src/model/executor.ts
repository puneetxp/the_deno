import type { database } from "../DB.ts";

export async function runQuery<T>(
  db: database<T>,
  sql: string,
  placeholders: Array<string | number>,
): Promise<unknown[]> {
  return await db.raw(sql, placeholders).get();
}
