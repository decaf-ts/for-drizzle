import { Adapter, BaseModel, pk, table } from "@decaf-ts/core";
import {
  AbsMigration,
  migration,
  MigrationService,
} from "@decaf-ts/core/migrations";
import { RamAdapter } from "@decaf-ts/core/ram";
import { uses } from "@decaf-ts/decoration";
import { model, Model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { DrizzleAdapter, DrizzleDatabase, DrizzleFlavour } from "../../src";
import { forEachDialect } from "../helpers/drizzleSetup";
import { useMigrationFlavour } from "../helpers/drizzleMigrations";

Model.setBuilder(Model.fromModel);

jest.setTimeout(180000);

const DRIZZLE_FLAVOUR = "drizzle-live-multi";
const RAM_FLAVOUR = "ram-live-multi";

const DRIZZLE_TABLE = "drizzle_multi_products";
const RAM_TABLE = "ram_multi_products";

@uses(DrizzleFlavour)
@table(DRIZZLE_TABLE)
@model()
class MultiProduct extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  name!: string;

  constructor(arg?: ModelArg<MultiProduct>) {
    super(arg);
  }
}

@migration("1.0.1-drizzle-live-multi", "1.0.1", DRIZZLE_FLAVOUR)
class DrizzleMigrationHop101 extends AbsMigration<DrizzleAdapter> {
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
      `ALTER TABLE ${DRIZZLE_TABLE} ADD COLUMN category VARCHAR(255)`,
      true
    );
    await adapter.raw(
      `UPDATE ${DRIZZLE_TABLE} SET category = 'dairy' WHERE category IS NULL`,
      true
    );
  }
}

@migration("1.0.2-drizzle-live-multi", "1.0.2", DRIZZLE_FLAVOUR)
class DrizzleMigrationHop102 extends AbsMigration<DrizzleAdapter> {
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
      `ALTER TABLE ${DRIZZLE_TABLE} ADD COLUMN stage VARCHAR(255)`,
      true
    );
    await adapter.raw(
      `UPDATE ${DRIZZLE_TABLE} SET stage = 'stable' WHERE stage IS NULL`,
      true
    );
  }
}

@migration("1.0.1-ram-live-multi", "1.0.1", RAM_FLAVOUR)
class RamMigrationHop101 extends AbsMigration<RamAdapter> {
  protected getQueryRunner(conn: any): any {
    return conn;
  }

  async up(): Promise<void> {
    return;
  }

  async down(): Promise<void> {
    return;
  }

  async migrate(qr: any): Promise<void> {
    const table = qr.get(RAM_TABLE);
    if (!table) return;
    for (const [id, doc] of table.entries()) {
      table.set(id, {
        ...doc,
        ramCategory: doc.ramCategory || "dairy",
      });
    }
  }
}

@migration("1.0.2-ram-live-multi", "1.0.2", RAM_FLAVOUR)
class RamMigrationHop102 extends AbsMigration<RamAdapter> {
  protected getQueryRunner(conn: any): any {
    return conn;
  }

  async up(): Promise<void> {
    return;
  }

  async down(): Promise<void> {
    return;
  }

  async migrate(qr: any): Promise<void> {
    const table = qr.get(RAM_TABLE);
    if (!table) return;
    for (const [id, doc] of table.entries()) {
      table.set(id, {
        ...doc,
        ramStage: doc.ramStage || "stable",
      });
    }
  }
}

void DrizzleMigrationHop101;
void DrizzleMigrationHop102;
void RamMigrationHop101;
void RamMigrationHop102;

forEachDialect(
  "for-drizzle live multi-adapter migration",
  async (handle) => {
    const drizzle = handle.adapter;
    const release = useMigrationFlavour(handle, DRIZZLE_FLAVOUR);
    const ram = new RamAdapter({} as any, RAM_FLAVOUR);

    const versions: Record<string, string> = {
      [DRIZZLE_FLAVOUR]: "1.0.0",
      [RAM_FLAVOUR]: "1.0.0",
    };

    try {
      await ram.initialize();
      await drizzle.index(MultiProduct);
      await drizzle.raw(
        `INSERT INTO ${DRIZZLE_TABLE} (id, name) VALUES (1, 'milk')`,
        true
      );

      ram.client.set(
        RAM_TABLE,
        new Map([["r-1", { id: "r-1", name: "ram-storage" }]])
      );

      await MigrationService.migrateAdapters(
        [drizzle as any, ram as any],
        {
          toVersion: "1.0.2",
          handlers: {
            [DRIZZLE_FLAVOUR]: {
              retrieveLastVersion: async () => versions[DRIZZLE_FLAVOUR],
              setCurrentVersion: async (version: string) => {
                versions[DRIZZLE_FLAVOUR] = version;
              },
            },
            [RAM_FLAVOUR]: {
              retrieveLastVersion: async () => versions[RAM_FLAVOUR],
              setCurrentVersion: async (version: string) => {
                versions[RAM_FLAVOUR] = version;
              },
            },
          },
        } as any
      );

      const drizzleRows = await drizzle.raw<Record<string, any>[], true>(
        `SELECT * FROM ${DRIZZLE_TABLE}`,
        true
      );
      expect(drizzleRows.length).toBe(1);
      expect(drizzleRows[0].category).toBe("dairy");
      expect(drizzleRows[0].stage).toBe("stable");

      const ramDoc = ram.client.get(RAM_TABLE)?.get("r-1");
      expect(ramDoc?.ramCategory).toBe("dairy");
      expect(ramDoc?.ramStage).toBe("stable");

      expect(versions[DRIZZLE_FLAVOUR]).toBe("1.0.2");
      expect(versions[RAM_FLAVOUR]).toBe("1.0.2");
    } finally {
      await ram.shutdown().catch(() => undefined);
      Adapter.unregister(RAM_FLAVOUR);
      release();
    }
  }
);
