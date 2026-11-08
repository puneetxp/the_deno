import { database, DB } from "./DB.ts";
import type { relation, TheData } from "./type.ts";
import { buildJoinQuery } from "./model/sqlBuilder.ts";
import { runQuery } from "./model/executor.ts";
import { ident } from "./sql_dialect.ts";

type RelationFactory = Model<any> | (() => Model<any>);
export abstract class Model<_model> {
  constructor(
    protected name: string = "",
    protected table: string,
    protected nullable: string[] = [],
    protected fillable: string[] = [],
    protected model: string[] = [],
    protected relations: {
      [key: string]: {
        table: string;
        name: string;
        key: string;
        callback: () => RelationFactory;
      };
    } = {},
    protected cache: boolean = false,
  ) {
    this.db = DB<_model>(this.table, this.fillable, "*", this.cache);
  }
  public item!: _model;
  protected relationship: Record<string, relation> = {};
  protected data: TheData[] = [];
  protected insertid!: number;
  protected db!: database<_model>;
  public page: { [key: string]: any } = {};
  public items: _model[] | any = [];
  protected singular: boolean = false;
  protected _with: any;
  protected one!: string[];

  public setSingular(): this {
    this.singular = true;
    return this;
  }

  public clone(): this {
    const ModelClass = this.constructor as new () => Model<_model>;
    return new ModelClass() as this;
  }

  public async paginate(
    pageNumber: number = 1,
    pageItems: number = 25,
  ): Promise<this | null> {
    pageNumber = Number(
      new URLSearchParams(globalThis.location.search).get("page"),
    ) || pageNumber;
    pageItems = Number(
      new URLSearchParams(globalThis.location.search).get("pageItems"),
    ) || pageItems;
    this.page["result"] = this.count();
    if (this.page["result"]) {
      this.page["pageNumber"] = pageNumber;
      this.page["pageItems"] = pageItems;
      this.page["totalpages"] = this.page["result"] /
        this.page["pageItems"];
      this.page["get"] = new URLSearchParams(globalThis.location.search)
        .toString();
      let offset = (pageNumber - 1) * pageItems;
      while (offset > this.page["result"]) {
        offset -= pageItems;
      }
      this.db.OffsetQ(offset).LimitQ(pageItems);
      return await this.get();
    } else {
      return null;
    }
  }

  protected pages(number: number = 5): { [key: number]: string } {
    const pages: { [key: number]: string } = {};
    const int = Math.floor(number / 2);
    if (this.page["totalpages"] <= number) {
      for (let i = 1; i <= this.page["totalpages"]; ++i) {
        pages[i] = new URLSearchParams({ page: i.toString() }).toString() +
          "&" + this.page["get"];
      }
    } else if (
      this.page["pageNumber"] > int &&
      this.page["pageNumber"] >= this.page["totalpages"] - int
    ) {
      let i = this.page["pageNumber"] - int;
      while (Object.keys(pages).length < number) {
        pages[i] = new URLSearchParams({ page: i.toString() }).toString() +
          "&" + this.page["get"];
        ++i;
      }
    } else {
      let i = this.page["pageNumber"] < int
        ? 1
        : this.page["totalpages"] - number;
      while (Object.keys(pages).length < number) {
        pages[i] = new URLSearchParams({ page: i.toString() }).toString() +
          "&" + this.page["get"];
        ++i;
      }
    }
    return pages;
  }

  public async all(param?: URLPatternResult, where?: TheData): Promise<this> {
    const searchInput = param?.search?.input ?? "";
    const searchParams = new URLSearchParams(
      searchInput.startsWith("?") ? searchInput.slice(1) : searchInput,
    );
    const latest = searchParams.get("latest") ?? undefined;

    if (latest) {
      const d = new Date(latest);
      if (!Number.isNaN(d.getTime())) {
        return await this.wherec([
          ["updated_at", ">", latest],
        ]).get();
      }
    }
    if (where) {
      this.where(where);
    }
    return await this.get();
  }

  public reset(): this {
    this.db.resetdata();
    return this;
  }
  /**
   * Add conditions; calls chain with AND: where({a: 1}).where({b: [2, 3]}).
   * The builder is cleared after every query, so a new query starts empty.
   * Pass reset = true to drop conditions added earlier in this chain.
   */
  public where(where: any, reset: boolean = false): this {
    reset && this.reset();
    this.db.where(where);
    return this;
  }

  /**
   * Keep rows that have at least one related row, by relation name from the
   * model's relations map. Conditions on the related model go in `where`, as
   * an object or as a function that builds on the related model:
   *   Book_stock$().whereHas("book", { public_listing: 1 })
   *   Book$().whereHas("book_stock", (s) => s.where({ publish: 1 }).whereHas("product", { enable: 1 }))
   */
  public whereHas(
    relation: string,
    where?: Record<string, any> | ((related: Model<any>) => Model<any>),
    type: "AND" | "OR" = "AND",
  ): this {
    return this.relationExists(relation, where, type, "EXISTS");
  }

  /** Keep rows with no related row matching `where` (see whereHas). */
  public whereNotHas(
    relation: string,
    where?: Record<string, any> | ((related: Model<any>) => Model<any>),
    type: "AND" | "OR" = "AND",
  ): this {
    return this.relationExists(relation, where, type, "NOT EXISTS");
  }

  public orderBy(column: string, direction: "ASC" | "DESC" = "ASC"): this {
    this.db.OrderQ(column, direction);
    return this;
  }

  public limit(count: number, offset: number = 0): this {
    if (
      !Number.isInteger(count) || count < 0 || !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new Error(
        `limit needs whole numbers >= 0, got ${count}, ${offset}`,
      );
    }
    this.db.LimitQ(count).OffsetQ(offset);
    return this;
  }

  /** The SQL and parameters the current chain would run, without running it. */
  public toSQL(): { sql: string; params: any[] } {
    return this.db.toSQL();
  }

  // The name this model's table goes by in the SQL being built: an alias
  // when it is the inner side of a whereHas.
  protected sqlName?: string;
  // How deep this model sits in nested whereHas calls (0 = the query itself).
  protected hasDepth = 0;

  private relationExists(
    relation: string,
    where:
      | Record<string, any>
      | ((related: Model<any>) => Model<any>)
      | undefined,
    type: "AND" | "OR",
    op: "EXISTS" | "NOT EXISTS",
  ): this {
    const rel = this.relations[relation];
    const related = rel ? this.instantiateRelation(relation) : null;
    if (!rel || !related) {
      throw new Error(
        `${this.name}: no relation "${relation}" (has: ${
          Object.keys(this.relations).join(", ")
        })`,
      );
    }
    // Aliased <table>__<depth>, so a relation to the same table (category ->
    // parent category) and nested whereHas calls each refer to the right row.
    // The alias depends only on the chain, so every adapter writes the same SQL.
    related.hasDepth = this.hasDepth + 1;
    const alias = `${rel.table}__${related.hasDepth}`;
    related.sqlName = alias;
    if (typeof where === "function") {
      where(related);
    } else if (where) {
      related.where(where);
    }
    const inner = related.db.whereSQL();
    related.db.resetdata();
    const outer = this.sqlName ?? this.table;
    this.db.WhereRawQ(
      `${op} (SELECT 1 FROM ${rel.table} AS ${ident(alias)} WHERE ${
        ident(alias)
      }.${ident(rel.key)} = ${ident(outer)}.${ident(rel.name)}${
        inner.sql ? ` AND (${inner.sql})` : ""
      })`,
      inner.params,
      type,
    );
    return this;
  }

  public andWhere(data: any): this {
    this.db.WhereQ(data);
    return this;
  }

  public orWhere(data: any): this {
    this.db.WhereQ(data, "OR");
    return this;
  }

  public andWhereC(data: any): this {
    this.db.WhereCustomQ(data);
    return this;
  }

  public orWhereC(data: any): this {
    this.db.WhereCustomQ(data, "OR");
    return this;
  }

  public wherec(where: any): this {
    this.db.SelSet().WhereCustomQ(where);
    return this;
  }

  async get(): Promise<this> {
    await this.db.SelSet().exe();
    this.items = this.db.rows;
    return this;
  }

  public getnull(): this | null {
    this.db.SelSet().exe();
    this.items = Array.from(this.db.many());
    if (this.items?.length) {
      return this;
    }
    return null;
  }

  public count(): any {
    this.db.CountSet().exe();
    return Array.from(this.db.many());
  }

  public async first(select: string[] = ["*"]): Promise<_model | null> {
    if (this.db.getAction() !== "SELECT") {
      this.db.SelSet(select);
    }
    return await this.db.first();
  }

  // public _wherec(where: any[] = []): this {
  //     this.db.SelSet().WhereCustomQ(where);
  //     return this;
  // }

  // public _where(where: Record<string, any>): this {
  //     this.db.where(where);
  //     return this;
  // }

  // single
  public async find(value: any, key: string = "id"): Promise<this> {
    this.reset();
    this.item = await this.db.find({ [key]: value }).first();
    this.singular = true;
    return this;
  }

  public async getInserted(): Promise<any> {
    return await this.db.lastinsert();
  }

  public async getsInserted(): Promise<this> {
    this.items = await this.db.lastinserts();
    return this;
  }

  public async create(data: Partial<_model>): Promise<this> {
    this.reset();
    await this.db.LimitQ(null);
    await this.db.create(this.sanitize(data));
    this.item = await this.db.lastinsert();
    this.items = this.item ? [this.item] : [];
    this.singular = true;
    await this.db.resetdata();
    return this;
  }

  // insert
  public async insert(data: Partial<_model>[]): Promise<this> {
    this.reset();
    await this.db.insert(this.clean(data));
    return this;
  }

  // update
  /**
   * Insert rows, or update the row with the same id. Fillable columns are
   * written, and id is kept when given: generated models never list id as
   * fillable, and without it an upsert could only ever insert.
   */
  public async upsert(data: Partial<_model>[]): Promise<this> {
    this.reset();
    await this.db.upsert(data.map((row) => {
      const clean = this.sanitize(row);
      const id = (row as Record<string, unknown>)["id"];
      return id === undefined ? clean : { ...clean, id: id as TheData[string] };
    }));
    return this;
  }

  public async update(data: Partial<_model>): Promise<this> {
    const dbAny = this.db as any;
    const whereAnd = dbAny.__where["AND"].length
      ? [...dbAny.__where["AND"]]
      : null;
    const whereOr = dbAny.__where["OR"].length
      ? [...dbAny.__where["OR"]]
      : null;
    const cacheTarget = dbAny.cacheTarget;

    await this.db.update(this.sanitize(data));

    if (whereAnd || whereOr) {
      if (whereAnd) dbAny.__where["AND"] = whereAnd;
      if (whereOr) dbAny.__where["OR"] = whereOr;
      if (cacheTarget) dbAny.cacheTarget = cacheTarget;
      await this.get();
    } else {
      this.items = this.db.rows;
    }

    return this;
  }
  public async up(data: Partial<_model>[]): Promise<this> {
    this.db.UpSet();
    data.forEach((i) => this.db.UpdateQ(this.sanitize(i)));
    await this.db.exe();
    return this;
  }

  public toggle(
    where: any,
    filed: string = "enable",
  ): Promise<database<_model>> {
    // CASE instead of NOT: flag columns are 0/1 integers, and PostgreSQL's NOT
    // only takes booleans. Same result as MySQL's NOT on 0/1.
    const f = ident(filed);
    return this.db.UpSet().WhereQ(where).rawsql(
      `UPDATE ${this.table} SET ${f} = CASE WHEN ${f} = 0 THEN 1 ELSE 0 END`,
    ).exe();
  }

  // delete
  public delete(where: any): Promise<database<_model>> {
    return this.db.delete(where).exe();
  }

  public softDelete(
    where: any,
    field: string = "deleted_at",
  ): Promise<database<_model>> {
    return this.db.UpSet().WhereQ(where).rawsql(
      `UPDATE ${this.table} SET \`${field}\` = NOW()`,
    ).exe();
  }

  public clean(data: Partial<_model>[]): TheData[] {
    return data.map((item) => this.sanitize(item));
  }
  public sanitize(item: Partial<_model>): TheData {
    const sanitized: TheData = {};
    for (const [key, value] of Object.entries(item)) {
      if (!this.fillable.includes(key) || value === undefined) continue;
      sanitized[key] = value as TheData[string];
    }
    return sanitized;
  }

  // default output
  public toString(): Response {
    return Response.json(this.items);
  }

  // array output
  public array(): any {
    return this.items;
  }

  public toJSON(): any {
    if (this.singular && this.item) return this.item;
    if (Array.isArray(this.items) && this.items.length === 1) {
      return this.items[0];
    }
    if (Array.isArray(this.items) && this.items.length > 1) return this.items;
    if (this.item) return this.item;
    return this.items || [];
  }

  // call relationship
  // Better for spa and fastest way
  public async with(data: any, first: boolean = true): Promise<this> {
    if (this.items.length) {
      let x: any = {};
      if (Array.isArray(data)) {
        if (first) this._with = data;
        for (const item of data) {
          if (Array.isArray(item)) {
            for (const i of item) {
              x[i] = await this.with(i);
            }
          } else if (typeof item == "object") {
            for (const [key, value] of Object.entries(item)) {
              x = {
                ...this.isnull(
                  await (await this.relation(key))?.with(
                    value,
                  ),
                ),
                ...x,
              };
            }
          } else {
            x[item] = this.isnull(await this.relation(item));
          }
        }
      } else if (typeof data == "object") {
        for (const [key, value] of Object.entries(data)) {
          x = {
            ...this.isnull(
              await (await this.relation(key))?.with(value),
            ),
            ...x,
          };
        }
      } else {
        if (first) {
          this._with = [data];
        }
        x[data] = this.isnull(await this.relation(data));
      }
      this.singular || first
        ? x[this.name] = [this.items]
        : x[this.name] = this.items;
      this.items = x;
    }
    return this;
  }

  public isnull(x: any): any[] {
    if (x == null) {
      return [];
    }
    return x?.items;
  }

  private instantiateRelation(name: string): Model<any> | null {
    const relation = this.relations[name];
    if (!relation) return null;
    const candidate = relation.callback();
    if (typeof candidate === "function") {
      return candidate();
    }
    return candidate ?? null;
  }

  public async relation(data: string): Promise<Model<any> | null> {
    const where: any = {};
    const x = this.singular
      ? [this.items[this.relations[data]["name"]]]
      : this.items.map((item: { [x: string]: any }) =>
        item[this.relations[data]["name"]]
      );
    if (x.length > 0) {
      where[this.relations[data]["key"]] = x;
      const relationModel = this.instantiateRelation(data);
      if (!relationModel) {
        return null;
      }
      return (await relationModel.where(where).get());
    }
    return null;
  }

  /**
   * Load rows with their related rows in one query: a LEFT JOIN per relation,
   * generated from the model's relations map. Uses the chain built so far
   * (where, whereHas, orderBy, limit); `where` is a shorthand for one more
   * where() call.
   */
  public async withJoin(
    relations: string[],
    where?: Record<string, any>,
  ): Promise<this> {
    if (!relations?.length) return this;
    if (where) this.where(where);

    // The base table goes by its own name, so whereHas conditions, which
    // refer to it by table name, still match.
    const baseAlias = this.table;
    const joins = relations.map((relName) => {
      const rel = this.relations[relName];
      const relModel = rel ? this.instantiateRelation(relName) : null;
      if (!rel || !relModel) {
        throw new Error(
          `${this.name}: no relation "${relName}" (has: ${
            Object.keys(this.relations).join(", ")
          })`,
        );
      }
      return {
        alias: `r_${relName}`,
        table: rel.table,
        localKey: rel.name,
        foreignKey: rel.key,
        cols: (relModel as any)?.model ?? [],
        prefix: relName,
      };
    }).filter(Boolean) as Array<{
      alias: string;
      table: string;
      localKey: string;
      foreignKey: string;
      cols?: string[];
      prefix?: string;
    }>;

    const { sql, params } = this.joinSQL(baseAlias, joins);
    const rows = await runQuery(this.db, sql, params);
    this.items = this.hydrateJoinedRows(rows as any[], relations);
    return this;
  }

  /** The SQL withJoin(relations) would run for the chain so far, without running it. */
  public withJoinSQL(relations: string[]): { sql: string; params: any[] } {
    const joins = relations.map((relName) => {
      const rel = this.relations[relName];
      if (!rel) throw new Error(`${this.name}: no relation "${relName}"`);
      const relModel = this.instantiateRelation(relName);
      return {
        alias: `r_${relName}`,
        table: rel.table,
        localKey: rel.name,
        foreignKey: rel.key,
        cols: (relModel as any)?.model ?? [],
        prefix: relName,
      };
    });
    return this.joinSQL(this.table, joins);
  }

  private joinSQL(
    baseAlias: string,
    joins: Parameters<typeof buildJoinQuery>[3],
  ): { sql: string; params: any[] } {
    const { sql } = buildJoinQuery(this.table, baseAlias, this.model, joins);
    const where = this.db.whereSQL(baseAlias);
    const order = this.db.orderSQL(baseAlias);
    const limit = this.db.limitSQL();
    this.db.resetdata();
    return {
      sql: sql + (where.sql ? ` WHERE ${where.sql}` : "") + order + limit,
      params: where.params,
    };
  }

  private hydrateJoinedRows(rows: any[], relations: string[]): any[] {
    return rows.map((row) => {
      const base: any = {};
      const relData: Record<string, any> = {};
      for (const [key, value] of Object.entries(row)) {
        const [rel, col] = key.split("__");
        if (!col || !relations.includes(rel)) {
          base[key] = value;
        } else {
          relData[rel] = relData[rel] ?? {};
          relData[rel][col] = value;
        }
      }
      return { ...base, ...relData };
    });
  }

  //bindintosomepattern
  public sort(): this {
    if (typeof this.items == "object") {
      if (this._with && this._with.length) {
        this.items = this.sortout(this._with, this.items[this.name]);
      }
      if (this.singular) {
        this.items = this.items[0];
      }
    }
    return this;
  }

  public sortout(relation: any[], data: any, base: any = null): any {
    for (const item of relation) {
      data = Array.isArray(item)
        ? this.filter_relations(item, data, base)
        : this.filter_relation(item, data, base);
    }
    return data;
  }

  public filter_relation(model: string, data: any, base: any = null): any {
    return data?.map((item: any) => {
      const y = Object.values(
        (base ? base[model] : this.items[model] ?? []).filter((
          model_item: any,
        ) =>
          model_item[this.relations[model]["key"]] ===
            item[this.relations[model]["name"]]
        ),
      );
      return {
        ...item,
        [model]: this.one?.includes(model) ? (y[0] ?? "") : y,
      };
    }) || [];
  }

  public filter_relations(model: any, data: any, base: any = null): any {
    for (const index of Object.keys(data)) {
      for (const [key, item] of Object.entries(model)) {
        data = this.filter_relation(key, data);
        const relationModel = this.instantiateRelation(key);
        if (relationModel) {
          data[index][key] = relationModel
            .sortout(item as any[], data[index][key], base ? base : this.items);
        }
      }
    }
    return data;
  }

  public clear(): Promise<database<_model>> {
    return this.db.truncate().exe();
  }
}
