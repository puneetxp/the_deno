import "https://deno.land/std@0.173.0/dotenv/load.ts";
import { database, DB } from "./DB.ts";
import { relation, TheData } from "./type.ts";
export class Model {
  protected name = "";
  protected table!: string;
  protected nullable: string[] = [];
  protected fillable: string[] = [];
  protected model: string[] = [];
  protected relationship: Record<string, relation> = {};
  protected data: TheData[] = [];
  protected insertid!: number;
  protected DB!: database;
  Item!: Promise<any>;
  set(table: string) {
    this.table = table;
    this.DB = DB(table, this.fillable);
    return this;
  }
  find(value: string | number, key = "id") {
    return this.DB.find({ [key]: value });
  }
  all() {
    return this.DB.where({}).get() || [];
  }
  where(where: TheData) {
    this.Item = this.DB.where(this.clean(where)).get() || [];
    return this;
  }
  async create(data: TheData[]) {
    const create = await this.DB.create(this.cleans(data));
    return await create.lastinsertid();
  }
  del(where: TheData) {
    return this.DB.delete(this.clean(where));
  }
  with(Model: relation[]) {
  }
  update(where: TheData, data: TheData) {
    return this.DB.update(this.clean(where), this.clean(data));
  }
  upsert(where: TheData[]) {
    return this.DB.upsert(where);
  }
  cleans(data: TheData[]) {
    const _where: TheData[] = [];
    data.forEach((w, index) => {
      _where.push(this.clean(w));
    });
    return _where;
  }
  clean(data: TheData) {
    const _where: TheData = {};
    for (const property of this.model) {
      data[property] && (_where[property] = data[property]);
    }
    return _where;
  }
}
