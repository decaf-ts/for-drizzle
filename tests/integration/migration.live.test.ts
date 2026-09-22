import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BaseModel, pk, table } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { model, Model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { DrizzleFlavour, DrizzleMigrator } from "../../src";
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

jest.setTimeout(180000);

@uses(DrizzleFlavour)
@table("migration_item")
@model()
class MigrationItem extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  name!: string;

  constructor(arg?: ModelArg<MigrationItem>) {
    super(arg);
  }
}

function migrationSuite(
  label: string,
  dialect: "sqlite" | "mysql" | "postgres",
  create: () => Promise<DrizzleTestHandle | undefined>,
  timeout: number = MYSQL_TEST_TIMEOUT_MS
) {
  describe(label, () => {
    let handle: DrizzleTestHandle;
    let outDir: string;
    let createdId: number;

    beforeAll(async () => {
      outDir = fs.mkdtempSync(path.join(os.tmpdir(), `drizzle-${dialect}-`));
      handle = (await create()) as DrizzleTestHandle;
    }, timeout);

    afterAll(async () => {
      if (handle) await handle.cleanup();
      fs.rmSync(outDir, { recursive: true, force: true });
    });

    it("generates reviewable SQL for the model", async () => {
      const files = await DrizzleMigrator.generate(
        (handle.adapter as any).config,
        [MigrationItem],
        outDir
      );
      expect(files.length).toBe(1);
      const sql = fs.readFileSync(files[0], "utf8");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS");
      expect(sql).toContain("migration_item");
    });

    it("applies the schema and reads the data back", async () => {
      await handle.adapter.index(MigrationItem);
      const repo = drizzleRepository(handle.adapter, MigrationItem);
      const created = await repo.create(new MigrationItem({ name: "before" }));
      expect(created.id).toBeDefined();
      createdId = created.id as number;

      const read = await repo.read(created.id);
      expect(read.name).toBe("before");
    });

    it(
      "re-applies the migration and keeps data",
      async () => {
        // Re-running adapter.index() is idempotent for both dialects.
        await handle.adapter.index(MigrationItem);
        const repo = drizzleRepository(handle.adapter, MigrationItem);
        const read = await repo.read(createdId);
        expect(read.name).toBe("before");
      }
    );
  });
}

migrationSuite("live migration (sqlite)", "sqlite", () => createSqliteAdapter());
if (hasMysql()) {
  migrationSuite("live migration (mysql)", "mysql", () => createMysqlAdapter());
} else {
  console.warn(
    "[drizzle-tests] MYSQL_URI not set: mysql migration coverage not exercised"
  );
}

if (hasPostgres()) {
  migrationSuite(
    "live migration (postgres)",
    "postgres",
    () => createPostgresAdapter(),
    POSTGRES_TEST_TIMEOUT_MS
  );
} else {
  console.warn(
    "[drizzle-tests] POSTGRES_URI not set: postgres migration coverage not exercised"
  );
}
