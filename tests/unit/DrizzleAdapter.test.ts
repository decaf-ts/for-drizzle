import { ConflictError, NotFoundError } from "@decaf-ts/db-decorators";
import { DrizzleAdapter } from "../../src";
import { TestModel } from "../TestModel";
import {
  createMysqlAdapter,
  createSqliteAdapter,
  hasMysql,
  MYSQL_TEST_TIMEOUT_MS,
} from "../helpers/drizzleSetup";

const describeMysql = hasMysql() ? describe : describe.skip;

describe("DrizzleAdapter (sqlite)", () => {
  let handle: Awaited<ReturnType<typeof createSqliteAdapter>>;

  beforeAll(async () => {
    handle = await createSqliteAdapter();
  });

  afterAll(async () => {
    await handle.cleanup();
  });

  it("exposes the configured dialect and translated schema", () => {
    expect(handle.adapter).toBeInstanceOf(DrizzleAdapter);
    expect(handle.adapter.dialect).toBe("sqlite");
    const schema = handle.adapter.schema(TestModel);
    expect(schema.tableName).toBe("tst_user");
    expect(handle.adapter.pkColumnName(TestModel)).toBe("id");
  });

  it("materialises the table and its declared indexes", async () => {
    await handle.adapter.index(TestModel);
    const tables = (await handle.adapter.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='tst_user'",
      true
    )) as any[];
    expect(tables.length).toBe(1);
    const indexes = (await handle.adapter.raw(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='tst_user'",
      true
    )) as any[];
    expect(indexes.length).toBeGreaterThan(0);
  });

  it("is idempotent because DDL uses IF NOT EXISTS", async () => {
    await expect(handle.adapter.index(TestModel)).resolves.toBeUndefined();
  });

  it("returns raw rows with docsOnly and a { data, count } envelope otherwise", async () => {
    const docs = await handle.adapter.raw("SELECT 1 AS v", true);
    expect(Array.isArray(docs)).toBe(true);
    expect((docs as any[])[0].v).toBe(1);
    const envelope = (await handle.adapter.raw("SELECT 1 AS v", false)) as any;
    expect(envelope.data.length).toBe(1);
    expect(envelope.count).toBe(1);
  });

  it("throws NotFoundError when reading a missing primary key", async () => {
    await expect(handle.adapter.read(TestModel, 123456)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it(
    "normalises unique violations to ConflictError",
    async () => {
      // @unique is translated into the DDL, so the second create violates the
      // unique constraint and is normalised to ConflictError.
      const schema = handle.adapter.schema(TestModel);
      const row = {
        [schema.pk]: 1,
        name: "dup",
        nif: "111111111",
        createdBy: "tester",
        updatedBy: "tester",
      };
      await handle.adapter.create(TestModel, 1, row as any);
      await expect(
        handle.adapter.create(TestModel, 2, {
          ...row,
          [schema.pk]: 2,
        } as any)
      ).rejects.toBeInstanceOf(ConflictError);
    }
  );
});

describeMysql("DrizzleAdapter (mysql)", () => {
  let handle: Awaited<ReturnType<typeof createMysqlAdapter>>;

  beforeAll(async () => {
    handle = await createMysqlAdapter();
  }, MYSQL_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  it("exposes the mysql dialect and translated schema", () => {
    expect(handle!.adapter.dialect).toBe("mysql");
    expect(handle!.adapter.schema(TestModel).tableName).toBe("tst_user");
  });

  it("materialises the table and returns raw rows", async () => {
    await handle!.adapter.index(TestModel);
    const rows = (await handle!.adapter.raw(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'tst_user'",
      true
    )) as any[];
    expect(rows.length).toBe(1);
  });
});
