import { BaseModel, pk, table } from "@decaf-ts/core";
import {
  AbsMigration,
  migration,
  MigrationService,
} from "@decaf-ts/core/migrations";
import { SemverMigrationVersioning } from "@decaf-ts/core/migrations/SemverMigrationVersioning";
import { uses } from "@decaf-ts/decoration";
import { model, Model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { DrizzleAdapter, DrizzleDatabase, DrizzleFlavour } from "../../src";
import { forEachDialect } from "../helpers/drizzleSetup";
import { useMigrationFlavour } from "../helpers/drizzleMigrations";

Model.setBuilder(Model.fromModel);

jest.setTimeout(180000);

const ORDER_FLAVOUR = "drizzle-live-migration-order";
const ORDER_TABLE = "drizzle_migration_order";

function resolved(reference: string, version: string) {
  return {
    reference,
    version,
    flavour: ORDER_FLAVOUR,
    migration: {
      reference,
      precedence: null,
      flavour: ORDER_FLAVOUR,
      transaction: true,
      async up() {
        return;
      },
      async migrate() {
        return;
      },
      async down() {
        return;
      },
    },
  };
}

describe("for-drizzle migration legacy strategy", () => {
  it("defaults to legacy lexical ordering", () => {
    const service = new MigrationService<any>();
    const sorted = (service as any)
      .sort([resolved("1.10.0", "1.10.0"), resolved("1.2.0", "1.2.0")])
      .map((m: any) => m.reference);

    expect(sorted).toEqual(["1.10.0", "1.2.0"]);
  });

  it("supports semver ordering when strategy is injected", () => {
    const service = new MigrationService<any>();
    (service as any).versioning = new SemverMigrationVersioning();
    const sorted = (service as any)
      .sort([resolved("1.10.0", "1.10.0"), resolved("1.2.0", "1.2.0")])
      .map((m: any) => m.reference);

    expect(sorted).toEqual(["1.2.0", "1.10.0"]);
  });
});

describe("for-drizzle migration semver ordering", () => {
  it("keeps deterministic semver upgrade sequence", () => {
    const service = new MigrationService<any>();
    (service as any).versioning = new SemverMigrationVersioning();

    const sorted = (service as any)
      .sort([
        resolved("2.0.0", "2.0.0"),
        resolved("1.10.0", "1.10.0"),
        resolved("1.2.0", "1.2.0"),
      ])
      .map((m: any) => m.reference);

    expect(sorted).toEqual(["1.2.0", "1.10.0", "2.0.0"]);
  });
});

const executionOrder: string[] = [];

@uses(DrizzleFlavour)
@table(ORDER_TABLE)
@model()
class MigrationOrderLog extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  version!: string;

  constructor(arg?: ModelArg<MigrationOrderLog>) {
    super(arg);
  }
}

@migration("2.0.0-drizzle-order", "2.0.0", ORDER_FLAVOUR)
class OrderMigration200 extends AbsMigration<DrizzleAdapter> {
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
    executionOrder.push("2.0.0");
    await adapter.raw(
      `INSERT INTO ${ORDER_TABLE} (version) VALUES ('2.0.0')`,
      true
    );
  }
}

@migration("1.10.0-drizzle-order", "1.10.0", ORDER_FLAVOUR)
class OrderMigration110 extends AbsMigration<DrizzleAdapter> {
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
    executionOrder.push("1.10.0");
    await adapter.raw(
      `INSERT INTO ${ORDER_TABLE} (version) VALUES ('1.10.0')`,
      true
    );
  }
}

@migration("1.2.0-drizzle-order", "1.2.0", ORDER_FLAVOUR)
class OrderMigration120 extends AbsMigration<DrizzleAdapter> {
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
    executionOrder.push("1.2.0");
    await adapter.raw(
      `INSERT INTO ${ORDER_TABLE} (version) VALUES ('1.2.0')`,
      true
    );
  }
}

void OrderMigration120;
void OrderMigration110;
void OrderMigration200;

forEachDialect("migration execution order (live)", async (handle) => {
  const release = useMigrationFlavour(handle, ORDER_FLAVOUR);
  const versions: Record<string, string> = { [ORDER_FLAVOUR]: "1.0.0" };
  executionOrder.length = 0;
  try {
    await handle.adapter.index(MigrationOrderLog);

    await MigrationService.migrateAdapters([handle.adapter as any], {
      toVersion: "2.0.0",
      versioning: new SemverMigrationVersioning(),
      handlers: {
        [ORDER_FLAVOUR]: {
          retrieveLastVersion: async () => versions[ORDER_FLAVOUR],
          setCurrentVersion: async (version: string) => {
            versions[ORDER_FLAVOUR] = version;
          },
        },
      },
    } as any);

    expect(executionOrder).toEqual(["1.2.0", "1.10.0", "2.0.0"]);

    const rows = await handle.adapter.raw<Record<string, any>[], true>(
      `SELECT version FROM ${ORDER_TABLE} ORDER BY id`,
      true
    );
    expect(rows.map((row) => row.version)).toEqual([
      "1.2.0",
      "1.10.0",
      "2.0.0",
    ]);
    expect(versions[ORDER_FLAVOUR]).toBe("2.0.0");
  } finally {
    release();
  }
});
