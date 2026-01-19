import { database, DB } from "./DB.ts";
import type { relation, TheData } from "./type.ts";
import { buildJoinQuery } from "./model/sqlBuilder.ts";
import { runQuery } from "./model/executor.ts";
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
        callback: () =>(()=> Model<any>);
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
  public where(where: any, reset: boolean = true): this {
    reset && this.reset();
    this.db.where(where);
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
  public async upsert(data: Partial<_model>[]): Promise<this> {
    this.reset();
    await this.db.upsert(this.clean(data));
    return this;
  }

  public async update(data: Partial<_model>): Promise<this> {
    await this.db.update(this.sanitize(data));
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
    return this.db.UpSet().WhereQ(where).rawsql(
      `SET \`${filed}\` = NOT \`${filed}\``,
    ).exe();
  }

  // delete
  public delete(where: any): Promise<database<_model>> {
    return this.db.delete(where).exe();
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

  public async relation(data: string): Promise<Model<any> | null> {
    const where: any = {};
    const x = this.singular
      ? [this.items[this.relations[data]["name"]]]
      : this.items.map((item: { [x: string]: any }) =>
        item[this.relations[data]["name"]]
      );
    if (x.length > 0) {
      where[this.relations[data]["key"]] = x;
      return (await this.relations[data]["callback"]().where(where)
        .get());
    }
    return null;
  }

  /**
   * Eager load relations using SQL JOINs instead of multiple round-trips and JS-side O(n²) filtering.
   * `relations` should be keys from the model's `relations` map.
   * Optional `where` applies to the base table (AND conditions).
   */
  public async withJoin(
    relations: string[],
    where?: Record<string, any>,
  ): Promise<this> {
    if (!relations?.length) return this;

    const baseAlias = "b";
    const joins = relations.map((relName) => {
      const rel = this.relations[relName];
      if (!rel) return null;
      const relModel = rel.callback();
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

    const { sql, placeholders } = buildJoinQuery(
      this.table,
      baseAlias,
      this.model,
      joins,
      where,
    );

    const rows = await runQuery(this.db, sql, placeholders);
    this.items = this.hydrateJoinedRows(rows as any[], relations);
    return this;
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

  private sortout(relation: any[], data: any, base: any = null): any {
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
        data[index][key] = this.relations[key]["callback"]()
          .sortout(item as any[], data[index][key], base ? base : this.items);
      }
    }
    return data;
  }

  public clear(): Promise<database<_model>> {
    return this.db.truncate().exe();
  }
}
