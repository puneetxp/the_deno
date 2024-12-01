import { database, DB } from "./DB.ts";
import { relation, TheData } from "./type.ts";
export abstract class Model<_model> {
    protected table!: string;
    protected nullable: string[] = [];
    protected model: string[] = [];
    protected relationship: Record<string, relation> = {};
    protected data: TheData[] = [];
    protected insertid!: number;
    protected db!: database<_model>;
    public page: { [key: string]: any } = {};
    public items: _model[] | any = [];
    public item: _model;
    protected singular: boolean = false;
    protected _with: any;
    protected name: string = "";
    protected fillable: string[] = [];
    protected relations: {
        [key: string]: { name: string; key: string; callback: any };
    } = {};
    protected one!: string[];

    set(table: string) {
        this.table = table;
        this.db = DB<_model>(table, this.fillable);
        return this;
    }

    public setSingular(): this {
        this.singular = true;
        return this;
    }

    public paginate(pageNumber: number = 1, pageItems: number = 25): any {
        pageNumber =
            Number(new URLSearchParams(window.location.search).get("page")) ||
            pageNumber;
        pageItems = Number(
            new URLSearchParams(window.location.search).get("pageItems"),
        ) || pageItems;
        this.page["result"] = this.count();
        if (this.page["result"]) {
            this.page["pageNumber"] = pageNumber;
            this.page["pageItems"] = pageItems;
            this.page["totalpages"] = this.page["result"] /
                this.page["pageItems"];
            this.page["get"] = new URLSearchParams(window.location.search)
                .toString();
            let offset = (pageNumber - 1) * pageItems;
            while (offset > this.page["result"]) {
                offset -= pageItems;
            }
            this.db.OffsetQ(offset).LimitQ(pageItems);
            return this.get();
        } else {
            return null;
        }
    }

    protected pages(number: number = 5): { [key: number]: string } {
        const pages: { [key: number]: string } = {};
        const int = Math.floor(number / 2);
        if (this.page["totalpages"] <= number) {
            for (let i = 1; i <= this.page["totalpages"]; ++i) {
                pages[i] =
                    new URLSearchParams({ page: i.toString() }).toString() +
                    "&" + this.page["get"];
            }
        } else if (
            this.page["pageNumber"] > int &&
            this.page["pageNumber"] >= this.page["totalpages"] - int
        ) {
            let i = this.page["pageNumber"] - int;
            while (Object.keys(pages).length < number) {
                pages[i] =
                    new URLSearchParams({ page: i.toString() }).toString() +
                    "&" + this.page["get"];
                ++i;
            }
        } else {
            let i = this.page["pageNumber"] < int
                ? 1
                : this.page["totalpages"] - number;
            while (Object.keys(pages).length < number) {
                pages[i] =
                    new URLSearchParams({ page: i.toString() }).toString() +
                    "&" + this.page["get"];
                ++i;
            }
        }
        return pages;
    }

    public async all() {
        return await this.get();
    }

    public where(where: any) {
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

    public wherec(where: any) {
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
        return await this.db.SelSet(select).first();
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
        this.item = await this.db.find({ [key]: value }).first();
        this.singular = true;
        return this;
    }

    public async getInserted() {
        return await this.db.lastinsert();
    }

    public async getsInserted() {
        this.items = await this.db.lastinserts();
        return this;
    }

    public async create(data: TheData) {
        await this.db.create(this.sanitize(data));
        return this;
    }

    // insert
    public async insert(data: TheData[]) {
        await this.db.insert(this.clean(data));
        return this;
    }

    // update
    public async upsert(data: TheData[]) {
        await this.db.upsert(this.clean(data));
        return this;
    }

    public async update(data: any) {
        await this.db.update(this.sanitize(data));
        return this;
    }

    public toggle(where: any, filed: string = "enable") {
        return this.db.UpSet().WhereQ(where).rawsql(
            `SET \`${filed}\` = NOT \`${filed}\``,
        ).exe();
    }

    // delete
    public delete(where: any): any {
        return this.db.delete(where).exe();
    }

    public clean(data: any[]): any[] {
        return data.map((item) => Object.fromEntries(
            Object.entries(item).filter(([key]) =>
                this.fillable.includes(key)
            ),
        ));
    }
    public sanitize(item: TheData): TheData {
        return Object.fromEntries(
            Object.entries(item).filter(([key]) =>
                this.fillable.includes(key)
            ),
        );
    }

    // default output
    public toString(): Response {
        return Response.json(this.items);
    }

    // array output
    public array() {
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

    public isnull(x): any[] {
        if (x == null) {
            return [];
        }
        return x?.items;
    }

    public async relation(data: string) {
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
                ) => model_item[this.relations[model]["key"]] ===
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
                data[index][key] = new this.relations[key]["callback"]()
                    .sortout(item, data[index][key], base ? base : this.items);
            }
        }
        return data;
    }

    public clear() {
        this.db.truncate().exe();
    }
}
