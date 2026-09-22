import {
  BaseModel,
  column,
  Condition,
  pk,
  table,
} from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { Model, model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { DrizzleFlavour, generateDDL } from "../../src";
import {
  createMysqlAdapter,
  drizzleRepository,
  hasMysql,
  MYSQL_TEST_TIMEOUT_MS,
} from "../helpers/drizzleSetup";
import type { DrizzleTestHandle } from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(300000);

@uses(DrizzleFlavour)
@table("mysql_dialect_items")
@model()
class MysqlDialectItem extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @column("label")
  @required()
  label!: string;

  @column("amount")
  @required()
  amount!: number;

  @column("enabled")
  @required()
  enabled!: boolean;

  @column("born")
  born!: Date;

  constructor(arg?: ModelArg<MysqlDialectItem>) {
    super(arg);
  }
}

const describeMysql = hasMysql() ? describe : describe.skip;

describeMysql("mysql dialect", () => {
  let handle: DrizzleTestHandle;

  beforeAll(async () => {
    handle = (await createMysqlAdapter()) as DrizzleTestHandle;
    await handle.adapter.index(MysqlDialectItem);
  }, MYSQL_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  it("generates InnoDB DDL with mysql physical types", () => {
    const ddl = generateDDL(MysqlDialectItem, "mysql");
    const create = ddl.find((statement) =>
      statement.startsWith("CREATE TABLE")
    );
    expect(create).toBeDefined();
    expect(create).toContain("ENGINE=InnoDB");
    expect(create).toContain("`label` TEXT");
    expect(create).toContain("`amount` INT");
    expect(create).toMatch(/`enabled` (BOOLEAN|TINYINT)/i);
    expect(create).toContain("`born` DATETIME(3)");
  });

  it("materialises the expected information_schema column types", async () => {
    const rows = (await handle.adapter.raw(
      "SELECT COLUMN_NAME AS name, DATA_TYPE AS type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'mysql_dialect_items'",
      true
    )) as any[];
    const byName: Record<string, string> = {};
    rows.forEach((row) => {
      byName[row.name] = String(row.type).toLowerCase();
    });
    expect(byName.label).toContain("text");
    expect(byName.amount).toBe("int");
    expect(byName.born).toContain("datetime");
  });

  it("round-trips records", async () => {
    const repo = drizzleRepository(handle.adapter, MysqlDialectItem);
    const created = await repo.create(
      new MysqlDialectItem({
        id: 1,
        label: "alpha",
        amount: 5,
        enabled: true,
        born: new Date(Date.UTC(2024, 0, 1)),
      })
    );
    expect(created.id).toBe(1);

    const read = await repo.read(1);
    expect(read.label).toBe("alpha");
    expect(read.amount).toBe(5);
    expect(Boolean(read.enabled)).toBe(true);
    expect(new Date(read.born as any).getTime()).toBe(
      new Date(Date.UTC(2024, 0, 1)).getTime()
    );

    created.amount = 7;
    const updated = await repo.update(created);
    expect(updated.amount).toBe(7);

    await repo.delete(1);
    await expect(repo.read(1)).rejects.toBeDefined();
  });

  it(
    "boolean columns are reverted to boolean values",
    async () => {
      // The MySQL driver returns tinyint(1) as a number; the adapter now coerces
      // it back to a boolean before reverting the model.
      const repo = drizzleRepository(handle.adapter, MysqlDialectItem);
      await repo.create(
        new MysqlDialectItem({
          id: 2,
          label: "beta",
          amount: 1,
          enabled: true,
          born: new Date(Date.UTC(2024, 0, 2)),
        })
      );
      const read = await repo.read(2);
      expect(read.enabled).toBe(true);
    }
  );

  it("supports REGEXP and LIKE conditions", async () => {
    const repo = drizzleRepository(handle.adapter, MysqlDialectItem);
    await repo.createAll([
      new MysqlDialectItem({ id: 10, label: "alpha-one", amount: 1, enabled: true, born: new Date(Date.UTC(2024, 0, 2)) }),
      new MysqlDialectItem({ id: 11, label: "alpha-two", amount: 2, enabled: false, born: new Date(Date.UTC(2024, 0, 3)) }),
      new MysqlDialectItem({ id: 12, label: "beta", amount: 3, enabled: true, born: new Date(Date.UTC(2024, 0, 4)) }),
    ]);

    const regexp = await repo
      .select()
      .where(Condition.attr<MysqlDialectItem>("label").regexp("^alpha-"))
      .execute();
    expect(regexp.map((r) => r.id).sort()).toEqual([10, 11]);

    const startsWith = await repo
      .select()
      .where(Condition.attr<MysqlDialectItem>("label").startsWith("alpha-"))
      .execute();
    expect(startsWith).toHaveLength(2);

    const endsWith = await repo
      .select()
      .where(Condition.attr<MysqlDialectItem>("label").endsWith("two"))
      .execute();
    expect(endsWith.map((r) => r.id)).toEqual([11]);
  });
});
