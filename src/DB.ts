import * as mysql2 from "https://deno.land/x/mysql2/mod.ts";
import { TheData } from "./type.ts";
const connection = await mysql2.createConnection({
  host: Deno.env.get("DBHOST"),
  port: 3306,
  user: Deno.env.get("DBUSER"),
  password: Deno.env.get("DBPWD"),
  database: Deno.env.get("DBNAME"),
  connectionLimit: 4,
});
export class database {
  protected query = "";
  protected field: any;
  protected param: string[] = [];
  protected placeholder!: any[];
  public rows: any;
  constructor(
    protected table: string,
    protected fillable: string[] = [],
    protected col: string = "*",
  ) {}

  where(where: TheData) {
    this.placeholder = [];
    this.SelSet().WhereQ(where);
    return this;
  }

  find(where: TheData, limit = 1) {
    this.placeholder = [];
    return this.SelSet().WhereQ(where).LimitQ(limit).get(0);
  }

  create(data: TheData[]) {
    this.placeholder = [];
    return this.InSet().InsertQ(data).execute();
  }
  update(where: TheData, data: TheData) {
    this.placeholder = [];
    this.UpSet().UpdateQ(data).WhereQ(where).execute();
    return this;
  }
  delete(where: TheData) {
    this.placeholder = [];
    return this.DelSet().WhereQ(where);
  }
  upsert(data: TheData[]) {
    return this.InSet().UpsertQ(data).get();
  }
  async execute() {
    [this.rows, this.field] = await connection.execute(
      this.query,
      this.placeholder,
    );
    return this;
  }
  async get(n?: number) {
    await this.execute();
    if (typeof n == "number") {
      return await this.rows[0];
    }
    return this.rows;
  }

  UpsertQ(data: TheData[]) {
    this.placeholder = [];
    this.InsertQ(data);
    this.query += " on duplicate key update ";
    Object.keys(data[0]).forEach((i) =>
      this.fillable.includes(i) &&
      (this.query += "`" + i + "` = values(`" + i + "`)")
    );
    return this;
  }

  InsertQ(data: TheData[]) {
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

  UpdateQ(data: TheData) {
    this.query = `UPDATE ${this.table} SET `;
    const set = [];
    for (const [key, value] of Object.entries(data)) {
      this.placeholder.push(value);
      set.push(`${key} = (?)`);
    }
    this.query += set.join(" , ");
    return this;
  }

  SelectQ() {
    this.query = `SELECT ${this.col} FROM ${this.table}`;
    return this;
  }

  WhereQ(where: TheData) {
    const wherearray: string[] = [];
    for (const property in where) {
      const value = where[property];
      Array.isArray(value)
        ? this.placeholder.push(...value)
        : this.placeholder.push(value);
      wherearray.push(
        `${property} IN (${
          Array.isArray(value) ? placeholder(value.length).join(",") : "?"
        })`,
      );
    }
    if (wherearray.length > 0) {
      this.query += " WHERE " + wherearray.join(" AND ");
    }
    return this;
  }

  SelSet() {
    this.query = `SELECT ${this.col} FROM ${this.table}`;
    return this;
  }

  InSet() {
    this.query = `INSERT INTO ${this.table}`;
    return this;
  }

  UpSet() {
    this.query = `UPDATE ${this.table} SET `;
    return this;
  }

  DelSet() {
    this.query = `DELETE FROM ${this.table} `;
    return this;
  }

  LimitQ(limit: number) {
    this.query += " LIMIT " + limit;
    return this;
  }
  lastinsertid() {
    const value = [];
    for (let i = 0; i < this.rows.affectedRows; i++) {
      value.push(this.rows.insertId - i);
    }
    return this.where({ id: value }).get();
  }
}

export const DB = (table: string, fillable: string[], col?: string) =>
  new database(table, fillable, col);
function placeholder(i: number) {
  const r: string[] = [];
  for (let n = 0; n < i; n++) {
    r.push("?");
  }
  return r;
}
