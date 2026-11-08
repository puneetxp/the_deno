// Runs spec/query_cases.json: the query builder cases every adapter of the
// framework must pass. No database needed: toSQL()/withJoinSQL() don't run SQL.
import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.8";
import { Model } from "./Model.ts";
import { toPostgresSQL } from "./sql_dialect.ts";

type Step = [string, ...any[]];
type Spec = {
  models: Record<string, {
    table: string;
    columns: string[];
    relations: Record<
      string,
      { model: string; table: string; name: string; key: string }
    >;
  }>;
  cases: {
    name: string;
    model: string;
    chain: Step[];
    sql: string;
    params: any[];
  }[];
  errors: { name: string; model: string; chain: Step[]; message: string }[];
};

const spec: Spec = JSON.parse(
  await Deno.readTextFile(new URL("../spec/query_cases.json", import.meta.url)),
);

function make(name: string): Model<any> {
  const m = spec.models[name];
  const relations = Object.fromEntries(
    Object.entries(m.relations).map(([rel, r]) => [
      rel,
      {
        table: r.table,
        name: r.name,
        key: r.key,
        callback: () => make(r.model),
      },
    ]),
  );
  return new (class extends Model<any> {
    constructor() {
      super(name, m.table, [], m.columns, m.columns, relations);
    }
  })();
}

/** Apply the steps of a chain to a model. */
function replay(model: Model<any>, chain: Step[]): Model<any> {
  for (const [op, ...args] of chain) {
    switch (op) {
      case "where":
        model.where(args[0], args[1] ?? false);
        break;
      case "whereHas":
      case "whereNotHas": {
        const [rel, cond] = args;
        const where = Array.isArray(cond)
          ? (r: Model<any>) => replay(r, cond)
          : cond;
        model[op](rel, where);
        break;
      }
      case "orderBy":
        model.orderBy(args[0], args[1]);
        break;
      case "limit":
        model.limit(args[0], args[1]);
        break;
      case "withJoin":
        break; // last step; sqlOf() handles it
      default:
        throw new Error(`spec uses unknown step "${op}"`);
    }
  }
  return model;
}

function sqlOf(c: { model: string; chain: Step[] }) {
  const last = c.chain[c.chain.length - 1];
  const model = replay(make(c.model), c.chain);
  return last?.[0] === "withJoin" ? model.withJoinSQL(last[1]) : model.toSQL();
}

for (const c of spec.cases) {
  Deno.test(`spec: ${c.name}`, () => {
    const got = sqlOf(c);
    assertEquals(got.sql.replace(/\s+/g, " ").trim(), c.sql);
    assertEquals(got.params, c.params);
    // The same chain gives the same SQL however many queries ran before it.
    assertEquals(sqlOf(c).sql, got.sql);
  });
}

for (const e of spec.errors) {
  Deno.test(`spec error: ${e.name}`, () => {
    assertThrows(() => sqlOf(e), Error, e.message);
  });
}

Deno.test("spec: PostgreSQL form is the same query with $n and double quotes", () => {
  const c = spec.cases.find((x) => x.name.startsWith("nested whereHas"))!;
  assertEquals(
    toPostgresSQL(c.sql),
    'SELECT * FROM books WHERE EXISTS (SELECT 1 FROM book_stocks AS "book_stocks__1" WHERE "book_stocks__1"."book_id" = "books"."id" AND ("publish" IN ($1) AND EXISTS (SELECT 1 FROM products AS "products__2" WHERE "products__2"."id" = "book_stocks__1"."product_id" AND ("enable" IN ($2)))))',
  );
});

Deno.test("toSQL clears the builder", () => {
  const m = make("product").where({ enable: 1 }).orderBy("id").limit(1);
  m.toSQL();
  assertEquals(m.toSQL().sql.trim(), "SELECT * FROM products");
});
