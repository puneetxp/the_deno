import { createPool as createMySQLPool } from "./mysql/mod.ts";
import { createPool as createPgPool } from "./postgres/mod.ts";
import type { TheData } from "./type.ts";
import { createCache, type KVCache } from "./KVCache.ts";
import {
  type DBDriver,
  ident,
  resolveDriver,
  toPostgresSQL,
  type WriteResult,
} from "./sql_dialect.ts";

export type DBAction =
  | "SELECT"
  | "COUNT"
  | "INSERT"
  | "UPDATE"
  | "DELETE"
  | "TRUNCATE"
  | "RAW";

type CacheTarget =
  | { scope: "all" }
  | { scope: "id"; id: string | number };

type QueryablePool = {
  query(sql: string, values?: unknown): Promise<[any, any]>;
  end(): Promise<void>;
};

function detectSocketPath(): string | null {
  const explicit = Deno.env.get("DBSOCKET");
  if (explicit) return explicit;

  const candidatesByOS: Record<string, string[]> = {
    linux: [
      "/run/mysqld/mysqld.sock",
      "/var/run/mysqld/mysqld.sock",
      "/var/lib/mysql/mysql.sock",
    ],
    darwin: [
      "/tmp/mysql.sock",
      "/opt/homebrew/var/mysql/mysql.sock",
      "/usr/local/var/mysql/mysql.sock",
    ],
  };

  const candidates = candidatesByOS[Deno.build.os] ?? [];
  for (const candidate of candidates) {
    try {
      const stat = Deno.statSync(candidate);
      if (stat.isSocket) {
        return candidate;
      }
    } catch {
      // ignore missing paths
    }
  }

  return null;
}

/** Which database the app talks to: `DBDRIVER=postgres`, or MySQL by default. */
export const dbDriver: DBDriver = resolveDriver(Deno.env.get("DBDRIVER"));

// Runs one statement. SELECTs (and raw statements that return rows) give
// the rows; builder INSERT/UPDATE/DELETE give a WriteResult in both drivers.
type Runner = {
  run(sql: string, values: any[], action: DBAction): Promise<[any, any]>;
  end(): Promise<void>;
};

let runner: Runner | null = null;
let runnerPromise: Promise<Runner> | null = null;

function getRunner(): Promise<Runner> {
  if (runner) return Promise.resolve(runner);
  runnerPromise ??= (dbDriver === "postgres" ? postgresRunner() : mysqlRunner())
    .then((r) => (runner = r))
    .catch((error) => {
      runnerPromise = null;
      throw error;
    });
  return runnerPromise;
}

/** Close the connection pool (tests and scripts; servers never need it). */
export async function closeDB(): Promise<void> {
  const r = runner ?? (runnerPromise ? await runnerPromise : null);
  runner = null;
  runnerPromise = null;
  await r?.end();
}

/**
 * MySQL/MariaDB client: the built-in TypeScript one by default, or npm:mysql2
 * with `MYSQL_CLIENT=mysql2` (loaded only then).
 */
export const mysqlClient: "native" | "mysql2" =
  Deno.env.get("MYSQL_CLIENT")?.trim().toLowerCase() === "mysql2"
    ? "mysql2"
    : "native";

async function mysqlRunner(): Promise<Runner> {
  const socketPath = detectSocketPath();
  const poolConfig = socketPath ? { socketPath } : {
    host: Deno.env.get("DBHOST"),
    port: Number(Deno.env.get("DBPORT") ?? "3306"),
  };
  const config = {
    ...poolConfig,
    user: Deno.env.get("DBUSER"),
    password: Deno.env.get("DBPWD"),
    database: Deno.env.get("DBNAME"),
    connectionLimit: Number(Deno.env.get("DBPOOL") ?? "4"),
  };
  let pool: QueryablePool;
  if (mysqlClient === "mysql2") {
    const mod: any = await import("npm:mysql2@3.11.0/promise");
    pool = (mod.default ?? mod).createPool(config);
  } else {
    pool = createMySQLPool({ ...config, tls: await tlsSetting() });
  }
  return {
    async run(sql, values) {
      const [rows, fields] = await pool.query(sql, values);
      return [rows, fields];
    },
    end: () => pool.end(),
  };
}

// The part of a pool's result used here (npm:pg and src/postgres agree).
type PgResult = {
  command: string | null;
  rowCount: number | null;
  rows: any[];
  fields: { name: string; dataTypeID: number }[];
};
type PgPool = {
  query(sql: string, values?: any[]): Promise<PgResult | PgResult[]>;
  end(): Promise<void>;
};

const PG_INT8 = 20;

/**
 * PostgreSQL client: the built-in TypeScript one by default, or npm:pg with
 * `PG_CLIENT=pg` (loaded only then).
 */
export const pgClient: "native" | "pg" =
  Deno.env.get("PG_CLIENT")?.trim().toLowerCase() === "pg" ? "pg" : "native";

/** DBSSL=on (+ DBSSL_CA, a PEM file): TLS options for either client. */
async function tlsSetting(): Promise<boolean | { caCerts: string[] }> {
  if (!["on", "1", "true"].includes(Deno.env.get("DBSSL") ?? "")) return false;
  const ca = Deno.env.get("DBSSL_CA");
  return ca ? { caCerts: [await Deno.readTextFile(ca)] } : true;
}

async function postgresRunner(): Promise<Runner> {
  const config = {
    // DBSOCKET is the socket *directory* for PostgreSQL, e.g. /run/postgresql.
    host: Deno.env.get("DBSOCKET") || Deno.env.get("DBHOST"),
    port: Number(Deno.env.get("DBPORT") ?? "5432"),
    user: Deno.env.get("DBUSER"),
    password: Deno.env.get("DBPWD"),
    database: Deno.env.get("DBNAME"),
    max: Number(Deno.env.get("DBPOOL") ?? "4"),
  };
  let pool: PgPool;
  if (pgClient === "pg") {
    const mod: any = await import("npm:pg@8.13.1");
    const pg = mod.default ?? mod;
    pool = new pg.Pool({
      ...config,
      types: {
        // bigint/bigserial ids come back as numbers, as they do from mysql2
        // (the built-in client does this itself). NUMERIC stays a string.
        getTypeParser(oid: number, format?: string) {
          if (oid === PG_INT8) {
            return (v: string) => {
              const n = Number(v);
              return Number.isSafeInteger(n) ? n : v;
            };
          }
          return pg.types.getTypeParser(oid, format);
        },
      },
    });
  } else {
    pool = createPgPool({ ...config, tls: await tlsSetting() });
  }
  return {
    async run(sql, values, action) {
      const res = await pool.query(toPostgresSQL(sql), values);
      const last = Array.isArray(res) ? res[res.length - 1] : res;
      const isWrite = ["INSERT", "UPDATE", "DELETE"].includes(
        last.command ?? "",
      );
      if (isWrite && (action !== "RAW" || last.fields.length === 0)) {
        const ids = last.command === "INSERT"
          ? last.rows.map((r) => r?.id).filter((id) => id != null)
          : [];
        const result: WriteResult = {
          insertId: ids.length ? ids[0] : null,
          affectedRows: last.rowCount ?? 0,
          insertIds: ids,
        };
        return [result, last.fields];
      }
      return [last.rows, last.fields];
    },
    end: () => pool.end(),
  };
}

// Marks a where entry that holds ORM-generated SQL instead of [column, op, value].
const RAW = Symbol("raw-condition");

export class database<_model> {
  protected query = "";
  protected field: any;
  protected param: string[] = [];
  protected placeholder: any[] = [];
  protected enable: boolean | null = null;
  protected limit: number | null = null;
  protected offset: number | null = null;
  protected __where: Record<string, any> = {
    "AND": [],
    "OR": [],
  };
  protected action: DBAction = "RAW";
  protected order: [string, "ASC" | "DESC"][] = [];
  protected cacheTarget: CacheTarget | null = null;
  protected kv?: KVCache;
  rows: any;
  constructor(
    protected table: string,
    protected fillable: string[] = [],
    protected col: string = "*",
    protected cache: boolean = false,
  ) {
    if (this.cache) {
      this.kv = createCache(this.table);
    }
  }

  raw(sql: string, bind: any[] = []): this {
    this.query = sql;
    this.placeholder = bind;
    return this;
  }

  where(where: TheData): this {
    this.SelSet();
    this.cacheTarget = null;
    return this.WhereQ(where);
  }

  find(where: TheData, limit = 1): this {
    this.SelSet();
    this.cacheTarget = this.extractIdTarget(where);
    return this.WhereQ(where).LimitQ(limit);
  }

  async create(data: TheData): Promise<database<_model>> {
    return await this.InSet().CreateQ(data).exe();
  }

  async update(data: TheData): Promise<database<_model>> {
    return await this.UpSet().UpdateQ(data).exe();
  }

  async insert(data: TheData[]): Promise<database<_model>> {
    return await this.InSet().InsertQ(data).exe();
  }

  delete(where: TheData): this {
    return this.DelSet().WhereQ(where);
  }

  async upsert(data: TheData[]): Promise<any> {
    return await this.InSet().UpsertQ(data).get();
  }

  async exe(): Promise<this> {
    const canUseCache = this.cache && this.kv &&
      this.action === "SELECT" && this.cacheTarget;
    if (canUseCache && this.cacheTarget) {
      if (this.cacheTarget.scope === "all") {
        const cached = await this.kv!.getAll<_model>();
        if (cached) {
          this.rows = cached;
          this.resetdata();
          return this;
        }
      } else {
        const cached = await this.kv!.get<_model>(this.cacheTarget.id);
        if (cached) {
          this.rows = [cached];
          this.resetdata();
          return this;
        }
      }
    }

    try {
      this.bind();
      if (dbDriver === "postgres" && this.action === "INSERT") {
        // PostgreSQL has no insertId; return the rows to read the ids from.
        this.query += " RETURNING *";
      }
      [this.rows, this.field] = await (await getRunner()).run(
        this.query,
        this.placeholder,
        this.action,
      );

      if (this.cache && this.kv) {
        if (this.action === "SELECT" && this.cacheTarget) {
          if (this.cacheTarget.scope === "all" && this.rows?.length) {
            await this.kv.setAll(this.rows);
          } else if (
            this.cacheTarget.scope === "id" && this.rows && this.rows[0]
          ) {
            await this.kv.set(this.cacheTarget.id, this.rows[0]);
          }
        }
        if (this.isWriteAction()) {
          await this.kv.invalidate();
        }
      }

      this.resetdata();
      return this;
    } catch (error) {
      // Log the error with context
      console.error(`[DATABASE ERROR] Query failed:`);
      console.error(`Query: ${this.query}`);
      console.error(`Params: ${JSON.stringify(this.placeholder)}`);
      console.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Reset data to prevent corrupted state
      this.resetdata();

      // Re-throw the error so it can be handled by the controller
      throw error;
    }
  }

  private isWriteAction(): boolean {
    return ["INSERT", "UPDATE", "DELETE", "TRUNCATE"].includes(this.action);
  }

  bind(): void {
    if (this.__where["AND"].length > 0) {
      if (this.enable) {
        this.WhereQ({ "enable": ["1"] });
      }
      this.query += " WHERE ";
      if (this.__where["AND"].length > 0) {
        this.bindwhere(this.__where["AND"], "AND");
      }
      if (this.__where["OR"].length > 0) {
        this.bindwhere(this.__where["OR"], "OR");
      }
    }

    if (this.action === "SELECT") {
      this.query += this.orderSQL();
    }
    if (this.limit && this.limit > 0) {
      this.query += " LIMIT " + this.limit;
    }
    if (this.offset && this.offset > 0) {
      this.query += " OFFSET " + this.offset;
    }
  }

  bindwhere(data: any, join: "AND" | "OR" = "AND"): void {
    this.query += (join == "AND" ? "" : " " + join + " ") +
      data.map((value: any) => {
        if (value[0] === RAW) {
          // A condition the ORM built itself (whereHas, whereNull).
          this.placeholder = [...this.placeholder, ...value[2]];
          return ` ${value[1]} `;
        }
        if (Array.isArray(value[2]) && value[2].length === 0) {
          // "IN ()" is invalid SQL: nothing is in an empty list.
          return String(value[1]).toUpperCase() === "NOT IN"
            ? " 1 = 1 "
            : " 1 = 0 ";
        }
        if (Array.isArray(value[2])) {
          this.placeholder = [...this.placeholder, ...value[2]];
          return ` ${this.colRef(value[0])} ${value[1]} (${
            value[2].map(() => "?").join(", ")
          })`;
        } else if (value[1] === "IN") {
          this.placeholder = [...this.placeholder, value[2]];
          return ` ${this.colRef(value[0])} ${value[1]} (?) `;
        } else {
          this.placeholder = [...this.placeholder, value[2]];
          return ` ${this.colRef(value[0])} ${value[1]} ? `;
        }
      }).join(` ${join} `);
  }

  many(): any {
    return this.rows;
  }

  async first(): Promise<_model> {
    return (await this.exe()).rows[0];
  }

  findQ(value: any, key = "id"): this {
    this.WhereQ({ [key]: value });
    return this;
  }

  async get(n?: number): Promise<any> {
    await this.exe();
    if (typeof n == "number") {
      return await this.rows[0];
    }
    return this.rows;
  }

  /**
   * Insert, or update the row that already exists. MySQL matches on any
   * unique key; PostgreSQL needs one named, so `conflict` defaults to `id`.
   */
  UpsertQ(data: TheData[], conflict: string[] = ["id"]): this {
    this.InsertQ(data);
    const cols = Object.keys(data[0] ?? {})
      .filter((i) => this.fillable.includes(i));
    if (dbDriver === "postgres") {
      const set = cols.filter((c) => !conflict.includes(c));
      this.query += ` ON CONFLICT (${conflict.map(ident).join(", ")}) ` +
        (set.length
          ? "DO UPDATE SET " +
            set.map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(", ")
          : "DO NOTHING");
    } else {
      this.query += " ON DUPLICATE KEY UPDATE " +
        cols.map((c) => ` ${ident(c)} = VALUES(${ident(c)}) `).join(", ");
    }
    return this;
  }

  rawsql(sql: string): this {
    this.query = sql;
    return this;
  }

  CreateQ(data: TheData): this {
    this.placeholder = [...this.placeholder, ...Object.values(data)];
    this.query += `( ${Object.keys(data).map(ident).join(",")} ) VALUES ( ${
      Object.values(data).map(() => "?").join(",")
    } )`;
    return this;
  }

  InsertQ(data: TheData[]): this {
    if (data.length > 0) {
      this.query += ` ( ${Object.keys(data[0]).map(ident).join(",")} ) VALUES `;
      const insert: any[] = [];
      data.forEach((i) => {
        for (const [key, value] of Object.entries(i)) {
          this.placeholder.push(value);
        }
        insert.push(`(${placeholder(Object.values(i).length).join(",")})`);
      });
      this.query += insert.join(",");
    }
    return this;
  }

  UpdateQ(data: TheData): this {
    this.query = `UPDATE ${this.table} SET `;
    const set: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      this.placeholder.push(value);
      set.push(` \`${key}\` = (?) `);
    }
    this.query += set.join(" , ");
    return this;
  }

  WhereQ(where: TheData, type: "AND" | "OR" = "AND"): this {
    // Column-name order, as in every adapter: the SQL never depends on key order.
    for (const property of Object.keys(where).sort()) {
      this.__where[type].push([property, "IN", where[property]]);
    }
    this.clearCacheTargetUnlessId();
    return this;
  }

  WhereCustomQ(where: any[], type: "AND" | "OR" = "AND"): this {
    where.forEach((element) => {
      this.__where[type].push([element[0], element[1], element[2]]);
    });
    this.cacheTarget = null;
    return this;
  }

  SelSet(col: string[] = ["*"]): this {
    this.action = "SELECT";
    this.cacheTarget = { scope: "all" };
    this.query = `SELECT ${col.join(" , ")} FROM ${this.table}`;
    return this;
  }

  CountSet(id = "*"): this {
    this.action = "COUNT";
    this.query = `SELECT count(${id}) FROM ${this.table}`;
    return this;
  }

  InSet(): this {
    this.action = "INSERT";
    this.query = `INSERT INTO ${this.table}`;
    return this;
  }

  UpSet(): this {
    this.action = "UPDATE";
    this.query = `UPDATE ${this.table} SET `;
    return this;
  }

  DelSet(): this {
    this.action = "DELETE";
    this.query = `DELETE FROM ${this.table} `;
    return this;
  }

  LimitQ(limit: number | null): this {
    this.limit = limit;
    if (
      limit !== null && limit !== undefined && this.cacheTarget?.scope === "all"
    ) {
      this.cacheTarget = null;
    }
    return this;
  }

  OffsetQ(Offset: number): this {
    this.offset = Offset;
    if (Offset && this.cacheTarget?.scope === "all") {
      this.cacheTarget = null;
    }
    return this;
  }

  lastinserts(): Promise<any> {
    const result = this.rows as WriteResult;
    // PostgreSQL reports every id; MySQL gives the first, and a multi-row
    // INSERT takes consecutive ids from it.
    const value: number[] = result.insertIds?.length
      ? [...result.insertIds]
      : [];
    if (!value.length && result.insertId != null) {
      for (let i = 0; i < result.affectedRows; i++) {
        value.push(result.insertId + i);
      }
    }
    return this.where({ id: value }).get();
  }
  lastinsert(): Promise<any> {
    return this.where({ id: (this.rows as WriteResult).insertId }).get(1);
  }

  truncate(): this {
    this.action = "TRUNCATE";
    this.cacheTarget = null;
    this.query = `TRUNCATE TABLE ${this.table}`;
    return this;
  }
  resetdata(): void {
    this.placeholder = [];
    this.__where = {
      "AND": [],
      "OR": [],
    };
    this.action = "RAW";
    this.cacheTarget = null;
    // Without this a LIMIT from find() stayed on the next query.
    this.limit = null;
    this.offset = null;
    this.order = [];
  }

  /** Add a condition the ORM generated (whereHas, whereNull). Not for app SQL. */
  WhereRawQ(sql: string, params: any[] = [], type: "AND" | "OR" = "AND"): this {
    this.__where[type].push([RAW, sql, params]);
    this.cacheTarget = null;
    return this;
  }

  OrderQ(column: string, direction: "ASC" | "DESC" = "ASC"): this {
    const d = String(direction).toUpperCase();
    if (d !== "ASC" && d !== "DESC") {
      throw new Error(
        `orderBy direction must be ASC or DESC, got "${direction}"`,
      );
    }
    this.order.push([column, d]);
    this.cacheTarget = null;
    return this;
  }

  // Table name or alias to qualify columns with while building a join query.
  protected qualifier: string | null = null;

  protected colRef(column: string): string {
    return this.qualifier
      ? `${ident(this.qualifier)}.${ident(column)}`
      : ident(column);
  }

  /**
   * The WHERE conditions so far, without the WHERE keyword; state is kept.
   * With `qualifier`, columns are written as qualifier.column (for joins).
   */
  whereSQL(qualifier: string | null = null): { sql: string; params: any[] } {
    const [query, placeholder] = [this.query, this.placeholder];
    this.query = "";
    this.placeholder = [];
    this.qualifier = qualifier;
    try {
      if (this.__where["AND"].length > 0) {
        this.bindwhere(this.__where["AND"], "AND");
        if (this.__where["OR"].length > 0) {
          this.bindwhere(this.__where["OR"], "OR");
        }
      }
      return { sql: this.query.trim(), params: this.placeholder };
    } finally {
      this.qualifier = null;
      [this.query, this.placeholder] = [query, placeholder];
    }
  }

  /** LIMIT/OFFSET for the chain so far ("" when none). */
  limitSQL(): string {
    return (this.limit && this.limit > 0 ? " LIMIT " + this.limit : "") +
      (this.offset && this.offset > 0 ? " OFFSET " + this.offset : "");
  }

  /** ORDER BY clause for the chain so far ("" when none), optionally qualified. */
  orderSQL(qualifier: string | null = null): string {
    if (!this.order.length) return "";
    const ref = (c: string) =>
      qualifier ? `${ident(qualifier)}.${ident(c)}` : ident(c);
    return " ORDER BY " +
      this.order.map(([c, d]) => `${ref(c)} ${d}`).join(", ");
  }

  /** The SELECT this builder would run, without running it; resets the builder. */
  toSQL(): { sql: string; params: any[] } {
    if (this.action !== "SELECT") this.SelSet();
    this.bind();
    const out = { sql: this.query, params: [...this.placeholder] };
    this.resetdata();
    return out;
  }

  getAction(): DBAction {
    return this.action;
  }

  protected extractIdTarget(where: TheData): CacheTarget | null {
    const keys = Object.keys(where);
    if (keys.length !== 1 || keys[0] !== "id") {
      return null;
    }
    const value = where["id"];
    const id = Array.isArray(value) ? value[0] : value;
    if (typeof id === "string" || typeof id === "number") {
      return { scope: "id", id };
    }
    return null;
  }

  protected clearCacheTargetUnlessId(): void {
    if (!this.cacheTarget || this.cacheTarget.scope !== "id") {
      this.cacheTarget = null;
    }
  }
}

export const DB = <T>(
  table: string,
  fillable: string[],
  col?: string,
  cache?: boolean,
): database<T> => new database<T>(table, fillable, col, cache);
function placeholder(i: number) {
  const r: string[] = [];
  for (let n = 0; n < i; n++) {
    r.push("?");
  }
  return r;
}
