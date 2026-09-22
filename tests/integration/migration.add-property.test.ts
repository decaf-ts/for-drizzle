import { BaseModel, pk, table } from "@decaf-ts/core";
import {
  AbsMigration,
  migration,
  MigrationService,
} from "@decaf-ts/core/migrations";
import { uses } from "@decaf-ts/decoration";
import { model, Model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { DrizzleAdapter, DrizzleDatabase, DrizzleFlavour } from "../../src";
import { forEachDialect } from "../helpers/drizzleSetup";
import { useMigrationFlavour } from "../helpers/drizzleMigrations";

Model.setBuilder(Model.fromModel);

jest.setTimeout(180000);

const TEST_FLAVOUR = "drizzle-live-migration-add-property";
const TABLE = "drizzle_migration_products";

@uses(DrizzleFlavour)
@table(TABLE)
@model()
class MigrationProduct extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  name!: string;

  @required()
  legacy!: string;

  constructor(arg?: ModelArg<MigrationProduct>) {
    super(arg);
  }
}

@migration("1.1.0-drizzle-live-add-category", "1.1.0", TEST_FLAVOUR)
class AddCategoryMigration extends AbsMigration<DrizzleAdapter> {
  protected getQueryRunner(conn: DrizzleDatabase): DrizzleDatabase {
    return conn;
  }

  async up(): Promise<void> {
    return;
  }

  async down(): Promise<void> {
    return;
  }

  async migrate(qr: DrizzleDatabase, adapter: DrizzleAdapter): Promise<void> {
    void qr;
    await adapter.raw(
      `ALTER TABLE ${TABLE} ADD COLUMN category VARCHAR(255)`,
      true
    );
    await adapter.raw(
      `UPDATE ${TABLE} SET category = 'dairy' WHERE category IS NULL`,
      true
    );
  }
}

@migration("2.0.0-drizzle-live-remove-legacy", "2.0.0", TEST_FLAVOUR)
class RemoveLegacyMigration extends AbsMigration<DrizzleAdapter> {
  protected getQueryRunner(conn: DrizzleDatabase): DrizzleDatabase {
    return conn;
  }

  async up(): Promise<void> {
    return;
  }

  async down(): Promise<void> {
    return;
  }

  async migrate(qr: DrizzleDatabase, adapter: DrizzleAdapter): Promise<void> {
    void qr;
    await adapter.raw(`ALTER TABLE ${TABLE} DROP COLUMN legacy`, true);
  }
}

void AddCategoryMigration;
void RemoveLegacyMigration;

forEachDialect(
  "for-drizzle migration property add/delete flow",
  async (handle) => {
    const release = useMigrationFlavour(handle, TEST_FLAVOUR);
    const versions: Record<string, string> = { [TEST_FLAVOUR]: "1.0.0" };
    try {
      await handle.adapter.index(MigrationProduct);
      await handle.adapter.raw(
        `INSERT INTO ${TABLE} (id, name, legacy) VALUES (1, 'milk', 'yes')`,
        true
      );

      await MigrationService.migrateAdapters([handle.adapter as any], {
        toVersion: "2.0.0",
        handlers: {
          [TEST_FLAVOUR]: {
            retrieveLastVersion: async () => versions[TEST_FLAVOUR],
            setCurrentVersion: async (version: string) => {
              versions[TEST_FLAVOUR] = version;
            },
          },
        },
      } as any);

      const rows = await handle.adapter.raw<Record<string, any>[], true>(
        `SELECT * FROM ${TABLE}`,
        true
      );
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe("milk");
      expect(rows[0].category).toBe("dairy");
      expect(rows[0].legacy).toBeUndefined();
      expect(versions[TEST_FLAVOUR]).toBe("2.0.0");
    } finally {
      release();
    }
  }
);
