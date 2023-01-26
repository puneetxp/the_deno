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
    this.DB = DB(table);
    return this;
  }
  find(value: string | number, key = "id") {
    return this.DB.find({ [key]: value })
  }
  all() {
    return this.DB.where({}).get() || [];
  }
  where(where: TheData) {
    this.Item = this.DB.where(this.clean([where])[0]).get() || [];
    return this;
  }
  async create(data: TheData[]) {
    const create = await this.DB.create(this.clean(data));
    return await create.lastinsertid();
  }
  del(where: TheData) {
    return this.DB.delete(this.clean([where])[0]);
  }
  with(Model: relation[]) {
  }
  update(where: TheData, data: TheData) {
    return this.DB.update(where, data);
  }
  clean(data: TheData[]) {
    const _where: TheData[] = [];
    data.forEach((w, index) => {
      _where[index] = {};
      for (const property of this.model) {
        w[property] && (_where[index][property] = w[property]);
      }
    });
    return _where;
  }
}
