import * as mysql2 from "https://deno.land/x/mysql2/mod.ts";
import { TheData, Where } from "./type.ts";
const DBConnection = mysql2.createPool({
  host: Deno.env.get("DBHOST"),
  port: 3306,
  user: Deno.env.get("DBUSER"),
  password: Deno.env.get("DBPWD"),
  database: Deno.env.get("DBNAME"),
  connectionLimit: 4,
});
export class database {
  protected client = DBConnection;
  protected query = "";
  protected rows: any;
  protected field: any;
  constructor(
    protected table: string,
    protected data: [] = [],
    protected col: string = "*",
  ) {}

  async where(where: Where[]) {
    await this.SelSet().WhereQ(where).execute();
    return this.rows;
  }

  async find(where: Where[], limit = 1) {
    await this.SelSet().WhereQ(where).LimitQ(limit).execute();
    return this.rows[0];
  }

  async create(data: TheData[]) {
    await this.InSet().InsertQ(data).execute();
    return this.rows;
  }

  async update(where: Where[], data: TheData[]) {
    await this.UpSet().UpdateQ(data).WhereQ(where).execute();
    return this.rows;
  }

  async execute() {
    [this.rows, this.field] = await this.client.execute(this.query);
  }

  async delete(where: Where[]) {
    await this.DelSet().WhereQ(where).execute();
    return this.rows;
  }

  InsertQ(data: TheData[]) {
    if (data.length > 0) {
      this.query += ` ( ${Object.keys(data[0]).join(",")} ) VALUES `;
      const insert: any[] = [];
      data.forEach((i) => {
        insert.push(`('${Object.values(i).join("','")}')`);
      });
      this.query += insert.join(",");
    }
    console.log(this.query);
    return this;
  }

  UpdateQ(data: TheData[]) {
    this.query = `UPDATE ${this.table} SET `;
    const set = [];
    for (const [key, value] of Object.entries(data)) {
      set.push(`${key} = '${value}'`);
    }
    this.query += set.join(" , ");
    return this;
  }
  SelectQ() {
    this.query = `SELECT ${this.col} FROM ${this.table}`;
    return this;
  }

  WhereQ(where: Where[] | Where = []) {
    if (Array.isArray(where)) {
      this.query += ` WHERE`;
      for (const property in where) {
        const value = where[property];
        this.query += ` ${property} IN ('${
          Array.isArray(value) ? value.join("','") : value
        }')`;
      }
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

  first(any: any) {
    return any[0];
  }
}

export const DB = (table: string) => new database(table);
