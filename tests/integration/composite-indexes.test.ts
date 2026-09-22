import {
  BaseModel,
  column,
  Condition,
  index,
  OrderDirection,
  pk,
  table,
} from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { Model, model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { DrizzleFlavour, generateDDL } from "../../src";
import { drizzleRepository, forEachDialect } from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(300000);

@uses(DrizzleFlavour)
@table("indexed_tasks")
@model()
class IndexedTask extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @required()
  @index([OrderDirection.ASC, OrderDirection.DSC], ["nextRunAt"])
  status!: string;

  @required()
  @index([OrderDirection.ASC, OrderDirection.DSC], ["bucket"])
  priority!: number;

  @required()
  bucket!: string;

  @column("next_run_at")
  @index([OrderDirection.ASC, OrderDirection.DSC])
  nextRunAt!: Date;

  @column("phys_col")
  @index(["status"])
  extra!: string;

  constructor(arg?: ModelArg<IndexedTask>) {
    super(arg);
  }
}

forEachDialect("composite index translation and queries", async (handle) => {
  const schema = handle.adapter.schema(IndexedTask);
  const ddl = generateDDL(IndexedTask, handle.dialect);
  const quote = handle.dialect === "mysql" ? "`" : '"';

  // Composite indexes are declared with the model property names.
  const statusIndex = schema.indexDefinitions.find((def) =>
    def.columns.includes("status")
  );
  expect(statusIndex).toBeDefined();
  expect(statusIndex!.columns).toEqual(["status", "nextRunAt"]);

  const priorityIndex = schema.indexDefinitions.find((def) =>
    def.columns.includes("priority")
  );
  expect(priorityIndex).toBeDefined();
  expect(priorityIndex!.columns).toEqual(["priority", "bucket"]);

  // DDL resolves the physical column names for each composite member.
  const compositeDdl = ddl.find((statement) =>
    statement.includes("INDEX") &&
    statement.includes("status") && statement.includes("next_run_at")
  );
  expect(compositeDdl).toBeDefined();
  expect(compositeDdl).toContain(
    `(${quote}status${quote}, ${quote}next_run_at${quote})`
  );

  const physicalIndex = ddl.find((statement) =>
    statement.includes("INDEX") &&
    statement.includes("phys_col")
  );
  expect(physicalIndex).toBeDefined();
  expect(physicalIndex).toContain(`(${quote}phys_col`);
  expect(physicalIndex).toContain(`${quote}status${quote})`);
  expect(physicalIndex).not.toContain(`(${quote}extra${quote}`);

  // Materialise the table and its indexes, then query through the composite key.
  await handle.adapter.index(IndexedTask);
  const repo = drizzleRepository(handle.adapter, IndexedTask);

  const created = await repo.createAll(
    [
      { id: 1, status: "pending", priority: 2, bucket: "b", nextRunAt: new Date(Date.UTC(2024, 0, 1)), extra: "e1" },
      { id: 2, status: "pending", priority: 1, bucket: "a", nextRunAt: new Date(Date.UTC(2024, 0, 3)), extra: "e2" },
      { id: 3, status: "pending", priority: 2, bucket: "a", nextRunAt: new Date(Date.UTC(2024, 0, 2)), extra: "e3" },
      { id: 4, status: "running", priority: 1, bucket: "a", nextRunAt: new Date(Date.UTC(2024, 0, 4)), extra: "e4" },
    ].map((row) => new IndexedTask(row))
  );
  expect(created).toHaveLength(4);

  const results = await repo
    .select()
    .where(Condition.attr<IndexedTask>("status").gte(""))
    .orderBy("status", OrderDirection.ASC)
    .thenBy("priority", OrderDirection.ASC)
    .thenBy("nextRunAt", OrderDirection.ASC)
    .execute();

  expect(results.map((r) => r.id)).toEqual([2, 1, 3, 4]);
  expect(
    results
      .filter((r) => r.status === "pending")
      .map((r) => r.priority)
  ).toEqual([1, 2, 2]);
});
