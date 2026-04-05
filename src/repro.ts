import { Model } from "./Model.ts";

class TestModel extends Model<any> {
  constructor() {
    super("test", "test_table", [], ["name"]);
  }
}

const model = new TestModel();

console.log("Testing Model.clean(undefined):");
try {
  const cleaned = model.clean(undefined as any);
  console.log("PASS: Model.clean(undefined) returned:", cleaned);
} catch (e: any) {
  console.log("FAIL: Model.clean(undefined) crashed:", e.message);
}

console.log("\nTesting Model.insert(undefined):");
try {
  // Mock db.insert to avoid real DB connection issues in this simple test
  (model as any).db = {
    resetdata: () => {},
    insert: () => Promise.resolve(),
  };
  await model.insert(undefined as any);
  console.log("PASS: Model.insert(undefined) completed without error");
} catch (e: any) {
  console.log("FAIL: Model.insert(undefined) crashed:", e.message);
}

console.log("\nTesting Model.upsert({ name: 'test' }):");
try {
  (model as any).db.upsert = () => Promise.resolve();
  await model.upsert({ name: "test" } as any);
  console.log("PASS: Model.upsert(single object) completed without error");
} catch (e: any) {
  console.log("FAIL: Model.upsert(single object) crashed:", e.message);
}
