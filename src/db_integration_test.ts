// Integration test of Model and DB against a real database: PostgreSQL with
// DBDRIVER=postgres, MySQL/MariaDB otherwise. Skipped unless DBTEST=1, because
// it creates and drops two tables (the_pg_items, the_pg_categories), e.g.:
//   DBTEST=1 DBDRIVER=postgres DBHOST=127.0.0.1 DBUSER=postgres \
//   DBNAME=the_test deno test -A src/db_integration_test.ts
import { assert, assertEquals } from "jsr:@std/assert@1.0.8";
import { closeDB, DB, dbDriver } from "./DB.ts";
import { Model } from "./Model.ts";

const enabled = Deno.env.get("DBTEST") === "1";
const pg = dbDriver === "postgres";

type Item = {
  id: number;
  name: string;
  order: number;
  enable: boolean | number;
  price: string;
  deleted_at: Date | null;
  category_id: number | null;
};
type Category = { id: number; title: string };

const itemCols = [
  "id",
  "name",
  "order",
  "enable",
  "price",
  "deleted_at",
  "category_id",
];

class Category$ extends Model<Category> {
  constructor() {
    super("category", "the_pg_categories", [], ["id", "title"], [
      "id",
      "title",
    ]);
  }
}

class Item$ extends Model<Item> {
  constructor() {
    super(
      "item",
      "the_pg_items",
      ["deleted_at", "category_id"],
      itemCols,
      itemCols,
      {
        category: {
          table: "the_pg_categories",
          name: "category_id",
          key: "id",
          callback: () => new Category$(),
        },
      },
    );
  }
}

Deno.test({
  name: `Model and DB work against ${pg ? "PostgreSQL" : "MySQL"}`,
  ignore: !enabled,
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const raw = DB<unknown>("the_pg_items", []);
    await raw.raw(`DROP TABLE IF EXISTS the_pg_items, the_pg_categories`).exe();
    const serial = pg ? "bigserial" : "bigint unsigned AUTO_INCREMENT";
    const fk = pg ? "bigint" : "bigint unsigned";
    await raw.raw(`CREATE TABLE the_pg_categories (
      id ${serial} PRIMARY KEY, title varchar(100) NOT NULL)`).exe();
    // "order" is a reserved word in both: proves column names get quoted.
    await raw.raw(`CREATE TABLE the_pg_items (
      id ${serial} PRIMARY KEY,
      name varchar(100) NOT NULL,
      \`order\` int NOT NULL DEFAULT 0,
      enable boolean NOT NULL DEFAULT true,
      price numeric(10,2) NOT NULL DEFAULT 0,
      deleted_at timestamp NULL DEFAULT NULL,
      category_id ${fk} NULL REFERENCES the_pg_categories(id))`).exe();

    try {
      const cat = (await new Category$().create({ title: "Tea" })).item;

      await t.step(
        "create returns the saved row with a numeric id",
        async () => {
          const m = await new Item$().create({
            name: "Assam",
            order: 2,
            price: "120.50",
            category_id: cat.id,
          });
          assertEquals(typeof m.item.id, "number");
          assertEquals(m.item.name, "Assam");
          assertEquals(m.item.order, 2);
          assertEquals(m.item.price, "120.50");
          assertEquals(Boolean(m.item.enable), true);
        },
      );

      await t.step("insert many and read back every inserted row", async () => {
        const db = DB<Item>("the_pg_items", itemCols);
        await db.insert([
          { name: "Darjeeling", order: 1 },
          { name: "Nilgiri", order: 3 },
        ]);
        const rows = await db.lastinserts();
        assertEquals(rows.map((r: Item) => r.name), ["Darjeeling", "Nilgiri"]);
      });

      await t.step("where, IN lists and custom operators", async () => {
        const byName = await new Item$().where({ name: ["Assam", "Nilgiri"] })
          .get();
        assertEquals(byName.items.length, 2);
        const gt = await new Item$().wherec([["order", ">", 1]]).get();
        assertEquals(gt.items.map((i: Item) => i.name).sort(), [
          "Assam",
          "Nilgiri",
        ]);
        const found = await new Item$().find("Darjeeling", "name");
        assertEquals(found.item.order, 1);
      });

      await t.step(
        "update with a where clause returns fresh rows",
        async () => {
          const m = await new Item$().where({ name: "Assam" }).update({
            price: "99.00",
          });
          assertEquals(m.items[0].price, "99.00");
        },
      );

      await t.step(
        "upsert updates on id conflict and inserts new rows",
        async () => {
          const existing = (await new Item$().find("Nilgiri", "name")).item;
          await new Item$().upsert([
            { id: existing.id, name: "Nilgiri FTGFOP", order: 3 },
          ]);
          const after = (await new Item$().find(existing.id)).item;
          assertEquals(after.name, "Nilgiri FTGFOP");
          await new Item$().upsert([{ name: "Kangra", order: 4 }]);
          const added = await new Item$().where({ name: "Kangra" }).get();
          assertEquals(added.items.length, 1);
        },
      );

      await t.step("toggle flips a boolean column", async () => {
        await new Item$().toggle({ name: "Assam" });
        const a = (await new Item$().find("Assam", "name")).item;
        assertEquals(Boolean(a.enable), false);
      });

      await t.step("softDelete sets the timestamp", async () => {
        await new Item$().softDelete({ name: "Darjeeling" });
        const d = (await new Item$().find("Darjeeling", "name")).item;
        assert(d.deleted_at instanceof Date);
      });

      await t.step("withJoin and with() load relations", async () => {
        const joined = await new Item$().withJoin(["category"], {
          name: "Assam",
        });
        assertEquals(joined.items[0].category.title, "Tea");
        const eager = await (await new Item$().where({ name: "Assam" }).get())
          .with(["category"]);
        assertEquals(eager.items.category[0].title, "Tea");
      });

      await t.step("delete reports affected rows", async () => {
        const db = DB<Item>("the_pg_items", itemCols);
        await db.delete({ name: ["Darjeeling"] }).exe();
        assertEquals(db.rows.affectedRows, 1);
      });

      // UPDATE ... RETURNING is PostgreSQL-only.
      await t.step({
        name: "raw SQL with ? placeholders and RETURNING",
        ignore: !pg,
        fn: async () => {
          const rows = await DB<Item>("the_pg_items", [])
            .raw(
              "UPDATE the_pg_items SET `order` = ? WHERE name = ? RETURNING `order`",
              [
                7,
                "Assam",
              ],
            ).get();
          assertEquals(rows, [{ order: 7 }]);
        },
      });
    } finally {
      await raw.raw(`DROP TABLE IF EXISTS the_pg_items, the_pg_categories`)
        .exe();
      await closeDB();
    }
  },
});
