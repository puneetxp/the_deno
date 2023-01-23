import "https://deno.land/std@0.173.0/dotenv/load.ts";
import { database, DB } from "./DB.ts";
import { relation, TheData, Where } from "./type.ts";
export class Model {
  protected name = "";
  protected table!: string;
  protected nullable: string[] = [];
  protected fillable: string[] = [];
  protected model: string[] = [];
  protected relationship: Record<string, relation> = {};
  protected data: TheData[] = [];
  protected DB!: database;
  Item!: Promise<any>;
  set(table: string) {
    this.table = table;
    this.DB = DB(table);
    return this;
  }
  find(value: string, key = "id") {
    this.Item = this.DB.find([{ col: key, value: [value] }]);
    return this;
  }
  all() {
    this.Item = this.DB.where([]) || [];
    return this;
  }
  where(where: Where[]) {
    this.Item = this.DB.where(where) || [];
    return this;
  }
  create(data: TheData[]) {
    return this.DB.create(data);
  }
  del(where: Where[]) {
    return this.DB.delete(where);
  }
  with(Model: relation[]) {
  }
  update(where: Where[], data: TheData[]) {
    return this.DB.update(where, data);
  }
  filter(data: TheData[]) {
    data.map((e) => {
      Object.entries(e).filter(([key]) => this.fillable.includes(key));
    });
    return this;
  }
}
