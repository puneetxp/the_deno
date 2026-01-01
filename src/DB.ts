import { mysql2 } from "../deps.ts";
import type { TheData } from "./type.ts";
import { createCache, type KVCache } from "./KVCache.ts";

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

type QueryablePool = mysql2.Pool & {
  query<T = unknown>(
    sql: string,
    values?: any[] | Record<string, unknown>,
  ): Promise<[T, mysql2.FieldPacket[]]>;
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

const socketPath = detectSocketPath();
const poolConfig = socketPath
  ? {
    socketPath,
  }
  : {
    host: Deno.env.get("DBHOST"),
    port: Number(Deno.env.get("DBPORT") ?? "3306"),
  };
const connection = mysql2.createPool({
  ...poolConfig,
  user: Deno.env.get("DBUSER"),
  password: Deno.env.get("DBPWD"),
  database: Deno.env.get("DBNAME"),
  connectionLimit: Number(Deno.env.get("DBPOOL") ?? "4"),
}) as QueryablePool;

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
      console.log(this.query);
      console.log(this.placeholder);
      [this.rows, this.field] = await connection.query(
        this.query,
        this.placeholder,
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
        if (Array.isArray(value[2])) {
          this.placeholder = [...this.placeholder, ...value[2]];
          return ` \`${value[0]}\` ${value[1]} (${
            value[2].map(() => "?").join(", ")
          })`;
        } else if (value[1] === "IN") {
          this.placeholder = [...this.placeholder, value[2]];
          return ` \`${value[0]}\` ${value[1]} (?) `;
        } else {
          this.placeholder = [...this.placeholder, value[2]];
          return ` \`${value[0]}\` ${value[1]} ? `;
        }
      }).join(join);
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

  UpsertQ(data: TheData[]): this {
    this.InsertQ(data);
    this.query += " on duplicate key update ";
    Object.keys(data[0]).forEach((i) =>
      this.fillable.includes(i) &&
      (this.query += "`" + i + "` = values(`" + i + "`)")
    );
    return this;
  }

  rawsql(sql: string): this {
    this.query = sql;
    return this;
  }

  CreateQ(data: TheData): this {
    this.placeholder = [...this.placeholder, ...Object.values(data)];
    this.query += `( ${Object.keys(data).join(",")} ) VALUES ( ${
      Object.values(data).map(() => "?").join(",")
    } )`;
    return this;
  }

  InsertQ(data: TheData[]): this {
    if (data.length > 0) {
      this.query += ` ( ${Object.keys(data[0]).join(",")} ) VALUES `;
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
      set.push(`${key} = (?)`);
    }
    this.query += set.join(" , ");
    return this;
  }

  WhereQ(where: TheData, type: "AND" | "OR" = "AND"): this {
    for (const property in where) {
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
    //console.log(this.rows);
    const value = [];
    for (let i = 0; i < this.rows.affectedRows; i++) {
      // @ts-ignore
      value.push(this.rows.insertId + i);
    }
    //console.log(value);
    return this.where({ id: value }).get();
  }
  lastinsert(): Promise<any> {
    //console.log(this.rows);
    return this.where({ id: this.rows.insertId }).get(1);
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
