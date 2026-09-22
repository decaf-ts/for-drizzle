import { BaseModel, column, Condition, OrderDirection, pk, table } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { model, Model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { DrizzleFlavour } from "../../src";
import {
  createMysqlAdapter,
  createSqliteAdapter,
  drizzleRepository,
  hasMysql,
  MYSQL_TEST_TIMEOUT_MS,
} from "../helpers/drizzleSetup";
import type { DrizzleTestHandle } from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(180000);

@uses(DrizzleFlavour)
@table("colmap_q")
@model()
class ColumnMappedQueryModel extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @column("mapped_name")
  @required()
  name!: string;

  @column("mapped_value")
  @required()
  value!: number;

  constructor(arg?: ModelArg<ColumnMappedQueryModel>) {
    super(arg);
  }
}

function regressionSuite(
  label: string,
  create: () => Promise<DrizzleTestHandle | undefined>
) {
  describe(label, () => {
    let handle: DrizzleTestHandle;

    beforeAll(async () => {
      handle = (await create()) as DrizzleTestHandle;
      await handle.adapter.index(ColumnMappedQueryModel);
      const repo = drizzleRepository(handle.adapter, ColumnMappedQueryModel);
      await repo.createAll([
        new ColumnMappedQueryModel({ id: 1, name: "alpha", value: 10 }),
        new ColumnMappedQueryModel({ id: 2, name: "beta", value: 20 }),
        new ColumnMappedQueryModel({ id: 3, name: "gamma", value: 30 }),
      ]);
    }, MYSQL_TEST_TIMEOUT_MS);

    afterAll(async () => {
      if (handle) await handle.cleanup();
    });

    it("where(Condition.attribute('value').gt(15)) matches the mapped column", async () => {
      const repo = drizzleRepository(handle.adapter, ColumnMappedQueryModel);
      const results = await repo
        .select()
        .where(Condition.attribute("value").gt(15))
        .execute();
      expect(results.length).toBe(2);
      expect(results.map((r) => r.id).sort((a, b) => a - b)).toEqual([2, 3]);
    });

    it("where(Condition.attribute('name').eq('beta')) matches the mapped column", async () => {
      const repo = drizzleRepository(handle.adapter, ColumnMappedQueryModel);
      const results = await repo
        .select()
        .where(Condition.attribute("name").eq("beta"))
        .execute();
      expect(results.length).toBe(1);
      expect(results[0].id).toBe(2);
    });

    it("findBy('name', 'gamma') matches the mapped column", async () => {
      const repo = drizzleRepository(handle.adapter, ColumnMappedQueryModel);
      const results = await repo.findBy("name", "gamma");
      expect(results.length).toBe(1);
      expect(results[0].id).toBe(3);
    });

    it("orderBy('value') sorts on the mapped column", async () => {
      const repo = drizzleRepository(handle.adapter, ColumnMappedQueryModel);
      const results = await repo
        .select()
        .orderBy("value", OrderDirection.DSC)
        .execute();
      expect(results.map((r) => r.id)).toEqual([3, 2, 1]);
    });

    it(
      "select(['name','value']) projects mapped fields",
      async () => {
        // Core Statement.processRecord calls Adapter.revert with a
        // property-keyed row; the adapter resolves the property names.
        const repo = drizzleRepository(handle.adapter, ColumnMappedQueryModel);
        const projected = await repo.select(["name", "value"]).execute();
        expect(projected.length).toBe(3);
        const byName = (n: string) => projected.find((r) => r.name === n)!;
        expect(byName("alpha").value).toBe(10);
        expect(byName("gamma").value).toBe(30);
      }
    );
  });
}

regressionSuite("REGRESSION: querying @column-mapped fields (sqlite)", () =>
  createSqliteAdapter()
);
if (hasMysql()) {
  regressionSuite("REGRESSION: querying @column-mapped fields (mysql)", () =>
    createMysqlAdapter()
  );
} else {
   
  console.warn(
    "[drizzle-tests] MYSQL_URI not set: mysql column-mapped query coverage not exercised"
  );
}
