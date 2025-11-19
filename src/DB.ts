import { mysql2 } from "../deps.ts";
import { TheData } from "./type.ts";

type QueryablePool = mysql2.Pool & {
    query<T = unknown>(
        sql: string,
        values?: any[] | Record<string, unknown>,
    ): Promise<[T, mysql2.FieldPacket[]]>;
};

const connection = mysql2.createPool({
    host: Deno.env.get("DBHOST"),
    port: 3306,
    user: Deno.env.get("DBUSER"),
    password: Deno.env.get("DBPWD"),
    database: Deno.env.get("DBNAME"),
    connectionLimit: 4,
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
        "OR": []
    };
    rows: any;
    constructor(
        protected table: string,
        protected fillable: string[] = [],
        protected col: string = "*",
    ) { }

    raw(sql: string, bind: any[] = []): this {
        this.query = sql;
        this.placeholder = bind;
        return this;
    }

    where(where: TheData): this {
        return this.SelSet().WhereQ(where);
    }

    find(where: TheData, limit = 1): this {
        return this.SelSet().WhereQ(where).LimitQ(limit);
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
        this.bind();
        //console.log(this.query);
        //console.log(this.placeholder);
        [this.rows, this.field] = await connection.query(
            this.query,
            this.placeholder,
        );
        this.resetdata();
        return this;
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
        this.query += (join == "AND" ? "" : " " + join + " ") + data.map((value: any) => {
            if (Array.isArray(value[2])) {
                this.placeholder = [...this.placeholder, ...value[2]];
                return ` \`${value[0]}\` ${value[1]} (${value[2].map(() => "?").join(", ")})`;
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

    async first() :Promise<_model> {
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
        this.query += `( ${Object.keys(data).join(",")} ) VALUES ( ${Object.values(data).map(() => "?").join(",")} )`;
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
        return this;
    }

    WhereCustomQ(where: any[], type: "AND" | "OR" = "AND"): this {
        where.forEach(element => {
            this.__where[type].push([element[0], element[1], element[2]]);
        });
        return this;
    }

    SelSet(col: string[] = ["*"]): this {
        this.query = `SELECT ${col.join(" , ")} FROM ${this.table}`;
        return this;
    }

    CountSet(id = "*"): this {
        this.query = `SELECT count(${id}) FROM this.table`;
        return this;
    }

    InSet(): this {
        this.query = `INSERT INTO ${this.table}`;
        return this;
    }

    UpSet(): this {
        this.query = `UPDATE ${this.table} SET `;
        return this;
    }

    DelSet(): this {
        this.query = `DELETE FROM ${this.table} `;
        return this;
    }

    LimitQ(limit: number | null): this {
        this.limit = limit;
        return this;
    }

    OffsetQ(Offset: number): this {
        this.offset = Offset;
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
        this.query = `TRUNCATE FROM ${this.table} `;
        return this;
    }
    resetdata(): void {
        this.placeholder = [];
        this.__where = {
            "AND": [],
            "OR": []
        };
    }

}

export const DB = <T>(table: string, fillable: string[], col?: string): database<T> => new database<T>(table, fillable, col);
function placeholder(i: number) {
    const r: string[] = [];
    for (let n = 0; n < i; n++) {
        r.push("?");
    }
    return r;
}
