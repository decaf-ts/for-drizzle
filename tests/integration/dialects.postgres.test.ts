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
  createPostgresAdapter,
  drizzleRepository,
  hasPostgres,
  POSTGRES_TEST_TIMEOUT_MS,
} from "../helpers/drizzleSetup";
import type { DrizzleTestHandle } from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(300000);

@uses(DrizzleFlavour)
@table("postgres_dialect_items")
@model()
class PostgresDialectItem extends BaseModel {
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

  constructor(arg?: ModelArg<PostgresDialectItem>) {
    super(arg);
  }
}

const describePostgres = hasPostgres() ? describe : describe.skip;

describePostgres("postgres dialect", () => {
  let handle: DrizzleTestHandle;

  beforeAll(async () => {
    handle = (await createPostgresAdapter()) as DrizzleTestHandle;
    await handle.adapter.index(PostgresDialectItem);
  }, POSTGRES_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  it("generates PostgreSQL DDL with postgres physical types", () => {
    const ddl = generateDDL(PostgresDialectItem, "postgres" as any);
    const create = ddl.find((statement) =>
      statement.startsWith("CREATE TABLE")
    );
    expect(create).toBeDefined();
    expect(create).not.toContain("ENGINE=InnoDB");
    expect(create).toContain('"label" TEXT');
    expect(create).toContain('"amount" INTEGER');
    expect(create).toMatch(/"enabled" BOOLEAN/);
    expect(create).toMatch(/"born" TIMESTAMP/);
  });

  it("materialises the expected information_schema column types", async () => {
    const rows = (await handle.adapter.raw(
      "SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'postgres_dialect_items'",
      true
    )) as any[];
    const byName: Record<string, string> = {};
    rows.forEach((row) => {
      byName[row.name] = String(row.type).toLowerCase();
    });
    expect(byName.label).toContain("text");
    expect(byName.amount).toBe("integer");
    expect(byName.enabled).toContain("boolean");
    expect(byName.born).toContain("timestamp");
  });

  it("round-trips records", async () => {
    const repo = drizzleRepository(handle.adapter, PostgresDialectItem);
    const created = await repo.create(
      new PostgresDialectItem({
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

  it("supports ILIKE and LIKE conditions", async () => {
    const repo = drizzleRepository(handle.adapter, PostgresDialectItem);
    await repo.createAll([
      new PostgresDialectItem({ id: 10, label: "alpha-one", amount: 1, enabled: true, born: new Date(Date.UTC(2024, 0, 2)) }),
      new PostgresDialectItem({ id: 11, label: "alpha-two", amount: 2, enabled: false, born: new Date(Date.UTC(2024, 0, 3)) }),
      new PostgresDialectItem({ id: 12, label: "beta", amount: 3, enabled: true, born: new Date(Date.UTC(2024, 0, 4)) }),
    ]);

    const startsWith = await repo
      .select()
      .where(Condition.attr<PostgresDialectItem>("label").startsWith("alpha-"))
      .execute();
    expect(startsWith).toHaveLength(2);

    const endsWith = await repo
      .select()
      .where(Condition.attr<PostgresDialectItem>("label").endsWith("two"))
      .execute();
    expect(endsWith.map((r) => r.id)).toEqual([11]);
  });
});
