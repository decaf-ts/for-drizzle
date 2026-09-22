import {
  BaseModel,
  column,
  Condition,
  OrderDirection,
  pk,
  table,
} from "@decaf-ts/core";
import {
  Model,
  model,
  ModelArg,
  required,
} from "@decaf-ts/decorator-validation";
import { uses } from "@decaf-ts/decoration";
import { DrizzleFlavour } from "../../src";
import {
  createSqliteAdapter,
  drizzleRepository,
  forEachDialect,
} from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(300000);

@uses(DrizzleFlavour)
@table("aggregate_products")
@model()
class AggregateProduct extends BaseModel {
  @pk({ type: String, generated: false })
  productCode!: string;

  @required()
  inventedName!: string;

  @required()
  nameMedicinalProduct!: string;

  @required()
  counter!: number;

  @column("launch_date")
  launchDate!: Date;

  constructor(arg?: ModelArg<AggregateProduct>) {
    super(arg);
  }
}

const inventedNames = [
  "name0",
  "name1",
  "name2",
  "name0",
  "name1",
  "name2",
  "name3",
  "name4",
  "name4",
  "name3",
  "name0",
  "name1",
  "name2",
  "name0",
  "name1",
  "name2",
  "name3",
  "name4",
  "name3",
  "name4",
];

forEachDialect("Drizzle repository aggregate operations", async (handle) => {
  await handle.adapter.index(AggregateProduct);
  const repo = drizzleRepository(handle.adapter, AggregateProduct);

  await repo.createAll(
    Array.from({ length: 20 }).map(
      (_, index) =>
        new AggregateProduct({
          productCode: `prod-${index}`,
          inventedName: inventedNames[index],
          nameMedicinalProduct: `medicine${index}`,
          counter: index,
          launchDate: new Date(2024, 0, index + 1),
        })
    )
  );

  // COUNT
  expect(await repo.count().execute()).toBe(20);
  expect(await repo.count("inventedName").execute()).toBe(20);
  expect(
    await repo
      .count()
      .where(Condition.attr<AggregateProduct>("counter").gt(15))
      .execute()
  ).toBe(4);

  // COUNT DISTINCT
  expect(await repo.count("inventedName").distinct().execute()).toBe(5);
  expect(
    await repo
      .count("inventedName")
      .distinct()
      .where(Condition.attr<AggregateProduct>("counter").lt(10))
      .execute()
  ).toBe(5);

  // MIN / MAX / SUM / AVG
  expect(await repo.min("counter").execute()).toBe(0);
  expect(await repo.max("counter").execute()).toBe(19);
  expect(await repo.sum("counter").execute()).toBe(190);
  expect(await repo.avg("counter").execute()).toBeCloseTo(9.5);

  const minDate = await repo.min("launchDate").execute();
  const maxDate = await repo.max("launchDate").execute();
  expect(new Date(minDate as any).getTime()).toBe(
    new Date(2024, 0, 1).getTime()
  );
  expect(new Date(maxDate as any).getTime()).toBe(
    new Date(2024, 0, 20).getTime()
  );

  // DISTINCT returns the bare scalar values.
  const distinctValues = await repo.distinct("inventedName").execute();
  expect([...(distinctValues as any[])].sort()).toEqual([
    "name0",
    "name1",
    "name2",
    "name3",
    "name4",
  ]);

  const filteredDistinct = await repo
    .distinct("inventedName")
    .where(Condition.attr<AggregateProduct>("counter").lt(6))
    .execute();
  expect([...(filteredDistinct as any[])].sort()).toEqual([
    "name0",
    "name1",
    "name2",
  ]);

  // IN
  const within = await repo
    .select()
    .where(Condition.attr<AggregateProduct>("counter").in([2, 5, 7]))
    .orderBy(["counter", OrderDirection.ASC])
    .execute();
  expect(within.map((r) => r.counter)).toEqual([2, 5, 7]);

  // Ordering and pagination
  const ordered = await repo
    .select()
    .orderBy(["counter", OrderDirection.DSC])
    .limit(3)
    .execute();
  expect(ordered.map((r) => r.counter)).toEqual([19, 18, 17]);

  const offset = await repo
    .select()
    .orderBy(["counter", OrderDirection.ASC])
    .limit(3)
    .offset(10)
    .execute();
  expect(offset.map((r) => r.counter)).toEqual([10, 11, 12]);
});

it(
  "groupBy without an aggregation selector is supported",
  async () => {
    // for-nano groups results into a Record keyed by the grouped attribute;
    // DrizzleStatement.buildAggregation supports bare groupBy selectors.
    const handle = await createSqliteAdapter([AggregateProduct]);
    try {
      const repo = drizzleRepository(handle.adapter, AggregateProduct);
      await repo.createAll(
        Array.from({ length: 5 }).map(
          (_, index) =>
            new AggregateProduct({
              productCode: `prod-${index}`,
              inventedName: `name${index}`,
              nameMedicinalProduct: `medicine${index}`,
              counter: index,
              launchDate: new Date(2024, 0, index + 1),
            })
        )
      );
      const grouped = await repo.select().groupBy("inventedName").execute();
      const keys = Object.keys(grouped as any).sort();
      expect(keys).toEqual([
        "name0",
        "name1",
        "name2",
        "name3",
        "name4",
      ]);
    } finally {
      await handle.cleanup();
    }
  }
);

it(
  "BETWEEN conditions are translated",
  async () => {
    // DrizzleStatement.parseCondition translates BETWEEN into
    // `column >= min and column <= max`.
    const handle = await createSqliteAdapter([AggregateProduct]);
    try {
      const repo = drizzleRepository(handle.adapter, AggregateProduct);
      await repo.createAll(
        Array.from({ length: 10 }).map(
          (_, index) =>
            new AggregateProduct({
              productCode: `prod-${index}`,
              inventedName: `name${index % 5}`,
              nameMedicinalProduct: `medicine${index}`,
              counter: index,
              launchDate: new Date(2024, 0, index + 1),
            })
        )
      );
      const between = await repo
        .select()
        .where(Condition.attr<AggregateProduct>("counter").between(5, 10))
        .orderBy(["counter", OrderDirection.ASC])
        .execute();
      expect(between.map((r) => r.counter)).toEqual([5, 6, 7, 8, 9]);
    } finally {
      await handle.cleanup();
    }
  }
);

it(
  "distinct returns bare scalar values",
  async () => {
    // distinct returns the scalar values rather than rows keyed by attribute.
    const handle = await createSqliteAdapter([AggregateProduct]);
    try {
      const repo = drizzleRepository(handle.adapter, AggregateProduct);
      await repo.createAll(
        Array.from({ length: 5 }).map(
          (_, index) =>
            new AggregateProduct({
              productCode: `prod-${index}`,
              inventedName: `name${index}`,
              nameMedicinalProduct: `medicine${index}`,
              counter: index,
              launchDate: new Date(2024, 0, index + 1),
            })
        )
      );
      const distinctValues = await repo.distinct("inventedName").execute();
      expect([...(distinctValues as any[])].sort()).toEqual([
        "name0",
        "name1",
        "name2",
        "name3",
        "name4",
      ]);
    } finally {
      await handle.cleanup();
    }
  }
);
