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
import {
  minlength,
  Model,
  model,
  ModelArg,
  required,
} from "@decaf-ts/decorator-validation";
import { DrizzleFlavour } from "../../src";
import {
  drizzleRepository,
  forEachDialect,
} from "../helpers/drizzleSetup";

const dayInMs = 24 * 60 * 60 * 1000;
const startTimestamp = Date.UTC(2024, 0, 1);

Model.setBuilder(Model.fromModel);

jest.setTimeout(300000);

@uses(DrizzleFlavour)
@table("date_query_objects")
@model()
class DateQueryObject extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @required()
  @minlength(5)
  @index([OrderDirection.ASC, OrderDirection.DSC])
  name!: string;

  @column("ts")
  @index([OrderDirection.ASC, OrderDirection.DSC])
  ts!: Date;

  constructor(arg?: ModelArg<DateQueryObject>) {
    super(arg);
  }
}

const toTimestamp = (offsetDays: number) =>
  new Date(startTimestamp + offsetDays * dayInMs);

forEachDialect("Drizzle queries with dates", async (handle) => {
  await handle.adapter.index(DateQueryObject);
  const repo = drizzleRepository(handle.adapter, DateQueryObject);

  const created = await repo.createAll(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(
      (i) =>
        new DateQueryObject({
          id: i,
          name: `user_name_${i}`,
          ts: toTimestamp(i - 1),
        })
    )
  );
  expect(created).toHaveLength(10);
  expect(created.every((el) => el.ts instanceof Date)).toBe(true);

  const all = await repo.select().execute();
  expect(all).toHaveLength(created.length);
  expect(all.every((s) => s instanceof DateQueryObject)).toBe(true);

  const before = toTimestamp(4);
  const beforeResults = await repo
    .select()
    .where(Condition.attr<DateQueryObject>("ts").lt(before))
    .execute();
  const expectedBefore = created.filter(
    (el) => el.ts.getTime() < before.getTime()
  ).length;
  expect(beforeResults).toHaveLength(expectedBefore);
  expect(
    beforeResults.every(
      (el) => new Date(el.ts as any).getTime() < before.getTime()
    )
  ).toBe(true);

  const pivot = toTimestamp(5);
  const afterResults = await repo
    .select()
    .where(Condition.attr<DateQueryObject>("ts").gte(pivot))
    .execute();
  const expectedAfter = created.filter(
    (el) => el.ts.getTime() >= pivot.getTime()
  ).length;
  expect(afterResults).toHaveLength(expectedAfter);
  expect(
    afterResults.every(
      (el) => new Date(el.ts as any).getTime() >= pivot.getTime()
    )
  ).toBe(true);

  const from = toTimestamp(2);
  const to = toTimestamp(7);
  const rangeCondition = Condition.attr<DateQueryObject>("ts")
    .gte(from)
    .and(Condition.attr<DateQueryObject>("ts").lte(to));
  const ranged = await repo.select().where(rangeCondition).execute();
  expect(ranged).toHaveLength(
    created.filter(
      (el) => el.ts.getTime() >= from.getTime() && el.ts.getTime() <= to.getTime()
    ).length
  );
  expect(
    ranged.every(
      (el) =>
        typeof el.name === "string" && el.name.startsWith("user_name_")
    )
  ).toBe(true);

  const ordered = await repo
    .select()
    .orderBy(["ts", OrderDirection.ASC])
    .execute();
  expect(ordered).toHaveLength(created.length);
  expect(new Date(ordered[0].ts as any).getTime()).toBe(
    created[0].ts.getTime()
  );
  expect(new Date(ordered[ordered.length - 1].ts as any).getTime()).toBe(
    created[created.length - 1].ts.getTime()
  );
});

it(
  "selected date columns are reverted to Date instances",
  async () => {
    // The adapter executes raw Drizzle SQL and coerces date columns back to Date
    // instances (from the driver scalar) before reverting the model.
    const { createSqliteAdapter } = await import("../helpers/drizzleSetup");
    const handle = await createSqliteAdapter([DateQueryObject]);
    try {
      const repo = drizzleRepository(handle.adapter, DateQueryObject);
      await repo.create(
        new DateQueryObject({
          id: 1,
          name: "user_name_1",
          ts: toTimestamp(0),
        })
      );
      const selected = await repo.select().execute();
      expect(selected[0].ts).toBeInstanceOf(Date);
    } finally {
      await handle.cleanup();
    }
  }
);
