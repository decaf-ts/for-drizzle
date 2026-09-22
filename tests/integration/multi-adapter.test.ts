import { Adapter, BaseModel, pk, table } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { Model, model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { DrizzleFlavour } from "../../src";
import {
  createMysqlAdapter,
  createPostgresAdapter,
  createSqliteAdapter,
  drizzleRepository,
  hasMysql,
  hasPostgres,
  MYSQL_TEST_TIMEOUT_MS,
  POSTGRES_TEST_TIMEOUT_MS,
} from "../helpers/drizzleSetup";
import type { DrizzleTestHandle } from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(300000);

@uses(DrizzleFlavour)
@table("multi_items")
@model()
class MultiItem extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @required()
  name!: string;

  constructor(arg?: ModelArg<MultiItem>) {
    super(arg);
  }
}

describe("multiple adapters", () => {
  let sqlite: DrizzleTestHandle;
  let mysql: DrizzleTestHandle | undefined;
  let postgres: DrizzleTestHandle | undefined;

  beforeAll(async () => {
    sqlite = await createSqliteAdapter([MultiItem]);
    if (hasMysql()) mysql = await createMysqlAdapter([MultiItem]);
    if (hasPostgres()) postgres = await createPostgresAdapter([MultiItem]);
  }, Math.max(MYSQL_TEST_TIMEOUT_MS, POSTGRES_TEST_TIMEOUT_MS));

  afterAll(async () => {
    if (postgres) await postgres.cleanup();
    if (mysql) await mysql.cleanup();
    if (sqlite) await sqlite.cleanup();
  });

  it("registers each adapter under its own alias", () => {
    expect(sqlite.adapter.alias).not.toBe(DrizzleFlavour);
    expect(Adapter.get(sqlite.adapter.alias)).toBe(sqlite.adapter);
    if (mysql) {
      expect(mysql.adapter.alias).not.toBe(sqlite.adapter.alias);
      expect(Adapter.get(mysql.adapter.alias)).toBe(mysql.adapter);
    } else {
      console.warn(
        "[drizzle-tests] MYSQL_URI is not set: multi adapter MySQL not exercised"
      );
      expect(sqlite.adapter.alias).toBeDefined();
    }
    if (postgres) {
      expect(postgres.adapter.alias).not.toBe(sqlite.adapter.alias);
      expect(postgres.adapter.alias).not.toBe(mysql?.adapter.alias);
      expect(Adapter.get(postgres.adapter.alias)).toBe(postgres.adapter);
    } else {
      console.warn(
        "[drizzle-tests] POSTGRES_URI is not set: multi adapter PostgreSQL not exercised"
      );
      expect(sqlite.adapter.alias).toBeDefined();
    }
  });

  it("binds repositories to their adapter alias", () => {
    const sqliteRepo = drizzleRepository(sqlite.adapter, MultiItem);
    expect(sqliteRepo.adapter).toBe(sqlite.adapter);
    if (mysql) {
      const mysqlRepo = drizzleRepository(mysql.adapter, MultiItem);
      expect(mysqlRepo.adapter).toBe(mysql.adapter);
      expect(mysqlRepo).not.toBe(sqliteRepo);
    } else {
      expect(sqliteRepo.adapter).toBe(sqlite.adapter);
    }
    if (postgres) {
      const postgresRepo = drizzleRepository(postgres.adapter, MultiItem);
      expect(postgresRepo.adapter).toBe(postgres.adapter);
      expect(postgresRepo).not.toBe(sqliteRepo);
      expect(postgresRepo).not.toBe(mysql && drizzleRepository(mysql.adapter, MultiItem));
    } else {
      expect(sqliteRepo.adapter).toBe(sqlite.adapter);
    }
  });

  it("stores records independently per adapter", async () => {
    const sqliteRepo = drizzleRepository(sqlite.adapter, MultiItem);
    await sqliteRepo.create(new MultiItem({ id: 1, name: "sqlite" }));
    expect((await sqliteRepo.read(1)).name).toBe("sqlite");

    if (!mysql) {
      console.warn(
        "[drizzle-tests] MYSQL_URI is not set: cross-adapter isolation not exercised"
      );
    } else {
      const mysqlRepo = drizzleRepository(mysql.adapter, MultiItem);
      await mysqlRepo.create(new MultiItem({ id: 1, name: "mysql" }));
      expect((await mysqlRepo.read(1)).name).toBe("mysql");
      // The sqlite row is untouched by the mysql write.
      expect((await sqliteRepo.read(1)).name).toBe("sqlite");
    }

    if (!postgres) {
      console.warn(
        "[drizzle-tests] POSTGRES_URI is not set: cross-adapter isolation not exercised"
      );
      return;
    }

    const postgresRepo = drizzleRepository(postgres.adapter, MultiItem);
    await postgresRepo.create(new MultiItem({ id: 1, name: "postgres" }));
    expect((await postgresRepo.read(1)).name).toBe("postgres");
    // The sqlite (and mysql) rows are untouched by the postgres write.
    expect((await sqliteRepo.read(1)).name).toBe("sqlite");
    if (mysql) {
      const mysqlRepo = drizzleRepository(mysql.adapter, MultiItem);
      expect((await mysqlRepo.read(1)).name).toBe("mysql");
    }
  });
});
