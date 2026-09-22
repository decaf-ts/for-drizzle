// Golden rule: the adapter (and its decoration overrides) must load before any
// model module so `Decoration.flavouredAs("drizzle")` overrides are registered
// before the task models are decorated.
import { DrizzleAdapter, DrizzleFlavour } from "../../src";
import { Adapter, PersistenceService } from "@decaf-ts/core";
Adapter.setCurrent(DrizzleFlavour);
DrizzleAdapter.decoration();
import {
  TaskBackoffModel,
  TaskEventBus,
  TaskHandlerRegistry,
  TaskModel,
  TaskService,
} from "@decaf-ts/core/tasks";
import Database from "better-sqlite3";
import { drizzle as sqliteDrizzle } from "drizzle-orm/better-sqlite3";
import { drizzle as mysqlDrizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import type { DrizzleConfig } from "../../src/types";
import {
  createMysqlAdapter,
  drizzleRepository,
  hasMysql,
  MYSQL_TEST_TIMEOUT_MS,
  mysqlUri,
} from "../helpers/drizzleSetup";
import { registerDrizzleOwnershipHandlers } from "../helpers/drizzleTaskSetup";

jest.setTimeout(120000);

registerDrizzleOwnershipHandlers();

const buildTask = (classification: string) =>
  new TaskModel({
    classification,
    maxAttempts: 3,
    backoff: new TaskBackoffModel(),
  } as any);

const uniqueAlias = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

function sqliteConfig(db: Database): DrizzleConfig {
  return {
    dialect: "sqlite",
    db: sqliteDrizzle(db) as any,
    client: db,
  };
}

const engineConfig = (
  adapter: DrizzleAdapter,
  workerId: string,
  overrides?: Partial<DrizzleConfig>
) =>
  ({
    adapter,
    bus: new TaskEventBus(),
    registry: new TaskHandlerRegistry(),
    workerId,
    concurrency: 1,
    leaseMs: 500,
    pollMsIdle: 1000,
    pollMsBusy: 200,
    logTailMax: 200,
    streamBufferSize: 5,
    maxLoggingBuffer: 100,
    loggingBufferTruncation: 10,
    gracefulShutdownMsTimeout: 4000,
    ...(overrides ? { overrides } : {}),
  }) as any;

describe("TaskService multi-db routing via overrides (sqlite)", () => {
  it("routes task persistence to a dedicated database", async () => {
    const mainSqlite = new Database(":memory:");
    mainSqlite.pragma("foreign_keys = ON");
    const dedicatedSqlite = new Database(":memory:");
    dedicatedSqlite.pragma("foreign_keys = ON");

    const mainConfig = sqliteConfig(mainSqlite);
    const dedicatedConfig = sqliteConfig(dedicatedSqlite);
    const mainAlias = uniqueAlias("multi_db_main");
    const dedicatedAlias = uniqueAlias("multi_db_dedicated");

    const persistence = new PersistenceService<DrizzleAdapter>();
    const { client } = await persistence.initialize([
      [DrizzleAdapter, mainConfig, mainAlias],
      [DrizzleAdapter, dedicatedConfig, dedicatedAlias],
    ]);
    const [mainAdapter, dedicatedAdapter] = client as DrizzleAdapter[];

    await mainAdapter.index(TaskModel);
    await dedicatedAdapter.index(TaskModel);

    const taskService = new TaskService<DrizzleAdapter>();
    await taskService.boot(
      engineConfig(mainAdapter, "drizzle-task-service", {
        db: dedicatedConfig.db,
        client: dedicatedConfig.client,
      })
    );

    try {
      const created = await taskService.create(buildTask("service-task"));

      const dedicatedRow = dedicatedSqlite
        .prepare("select classification from tasks where id = ?")
        .get(created.id) as { classification?: string } | undefined;
      expect(dedicatedRow?.classification).toBe("service-task");

      const mainRow = mainSqlite
        .prepare("select id from tasks where id = ?")
        .get(created.id);
      expect(mainRow).toBeUndefined();
    } finally {
      await taskService.shutdown();
      await persistence.shutdown();
      mainSqlite.close();
      dedicatedSqlite.close();
    }
  });
});

if (hasMysql()) {
  describe("TaskService multi-db routing via overrides (mysql)", () => {
    it("persists tasks through a dedicated adapter instance", async () => {
      const handle = await createMysqlAdapter();
      if (!handle) throw new Error("mysql handle unavailable");
      const dedicatedPool = mysql.createPool({
        uri: mysqlUri(),
        connectionLimit: 5,
      });
      const dedicatedConfig: DrizzleConfig = {
        dialect: "mysql",
        db: mysqlDrizzle(dedicatedPool) as any,
        client: dedicatedPool,
      };
      const dedicatedAdapter = new DrizzleAdapter(
        dedicatedConfig,
        uniqueAlias("multi_db_mysql")
      );
      try {
        await handle.adapter.index(TaskModel);
        await dedicatedAdapter.initialize();

        const taskService = new TaskService<DrizzleAdapter>();
        await taskService.boot(
          engineConfig(handle.adapter, "drizzle-task-service-mysql")
        );

        try {
          const created = await taskService.create(buildTask("service-task"));
          const dedicatedRepo = drizzleRepository(dedicatedAdapter, TaskModel);
          const persisted = await dedicatedRepo.read(created.id);
          expect(persisted.classification).toBe("service-task");
        } finally {
          await taskService.shutdown();
        }
      } finally {
        await dedicatedPool.end();
        await handle.cleanup();
      }
    }, MYSQL_TEST_TIMEOUT_MS);

    it(
      "Adapter.for keys overrides containing circular config objects (mysql)",
      async () => {
        const handle = await createMysqlAdapter();
        if (!handle) throw new Error("mysql handle unavailable");
        const dedicatedPool = mysql.createPool({
          uri: mysqlUri(),
          connectionLimit: 5,
        });
        try {
          handle.adapter.for({
            dialect: "mysql",
            db: mysqlDrizzle(dedicatedPool) as any,
            client: dedicatedPool,
          } as Partial<DrizzleConfig>);
        } finally {
          await dedicatedPool.end();
          await handle.cleanup();
        }
      },
      MYSQL_TEST_TIMEOUT_MS
    );
  });
} else {
  console.warn(
    "[drizzle-tests] MYSQL_URI not set: mysql multi-db task service not exercised"
  );
}
