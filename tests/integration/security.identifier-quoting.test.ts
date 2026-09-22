import {
  BaseModel,
  column,
  index,
  pk,
  table,
} from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { InternalError } from "@decaf-ts/db-decorators";
import { model, Model, ModelArg, required } from "@decaf-ts/decorator-validation";
import {
  DrizzleFlavour,
  createIndexSQL,
  generateDDL,
  translateModel,
} from "../../src";
import { createSqliteAdapter, drizzleRepository } from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(180000);

//
// SECURITY (regression, SAA-1612 F3) — DDL identifier quoting/validation.
//
// Pre-fix `quoteIdentifier` wrapped names in quotes without escaping embedded
// quote characters and `translateModel` accepted any string, so a decorated
// table/column/index name such as `poc") ; DROP TABLE x; --` could break out of
// the identifier and inject extra DDL (executed through `sql.raw`).
//
// Post-fix contract (SAA-1617): `assertValidIdentifier` rejects any physical
// identifier that is not `[A-Za-z_][A-Za-z0-9_$]*` (allowing the framework
// `??` prefix) at `translateModel`/DDL time, and `quoteIdentifier` doubles
// embedded quotes as defense-in-depth. A crafted name must fail fast — no broken
// or extra DDL may execute.
//
const INJECTED_TABLE = "x";
const EVIL_NAME = 'poc") ; DROP TABLE x; --';

@uses(DrizzleFlavour)
@table(EVIL_NAME)
@model()
class EvilTableName extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  name!: string;

  constructor(arg?: ModelArg<EvilTableName>) {
    super(arg);
  }
}

@uses(DrizzleFlavour)
@table("sec_ident_column")
@model()
class EvilColumnName extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @column(EVIL_NAME)
  @required()
  payload!: string;

  constructor(arg?: ModelArg<EvilColumnName>) {
    super(arg);
  }
}

@uses(DrizzleFlavour)
@table("sec_ident_index")
@model()
class EvilIndexName extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @index(EVIL_NAME)
  @required()
  label!: string;

  constructor(arg?: ModelArg<EvilIndexName>) {
    super(arg);
  }
}

@uses(DrizzleFlavour)
@table("sec_ident_safe")
@model()
class SafeIndexName extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @index("sec_ident_safe_label_idx")
  @required()
  label!: string;

  constructor(arg?: ModelArg<SafeIndexName>) {
    super(arg);
  }
}

describe("SECURITY (regression, F3): DDL identifier validation/quoting", () => {
  it.each(["sqlite", "mysql", "postgres"] as const)(
    "rejects a table name with embedded quotes (%s)",
    (dialect) => {
      expect(() => translateModel(EvilTableName, dialect)).toThrow(InternalError);
      expect(() => generateDDL(EvilTableName, dialect)).toThrow(InternalError);
    }
  );

  it.each(["sqlite", "mysql", "postgres"] as const)(
    "rejects a column name with embedded quotes (%s)",
    (dialect) => {
      expect(() => translateModel(EvilColumnName, dialect)).toThrow(InternalError);
      expect(() => generateDDL(EvilColumnName, dialect)).toThrow(InternalError);
    }
  );

  it.each(["sqlite", "mysql", "postgres"] as const)(
    "rejects an index name with embedded quotes (%s)",
    (dialect) => {
      expect(() => translateModel(EvilIndexName, dialect)).toThrow(InternalError);
      expect(() => generateDDL(EvilIndexName, dialect)).toThrow(InternalError);
      expect(() => createIndexSQL(translateModel(EvilIndexName, dialect))).toThrow(
        InternalError
      );
    }
  );

  it("executes no DDL for a crafted table name and leaves no injected table", async () => {
    const handle = await createSqliteAdapter();
    try {
      await expect(handle.adapter.index(EvilTableName)).rejects.toBeInstanceOf(
        InternalError
      );

      const client: any = (handle.adapter as any).config.client;
      const injected = client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
        )
        .get(INJECTED_TABLE);
      expect(injected).toBeUndefined();
    } finally {
      await handle.cleanup();
    }
  });

  it("keeps ordinary identifiers valid and queryable", async () => {
    const handle = await createSqliteAdapter();
    try {
      await handle.adapter.index(SafeIndexName);
      const repo = drizzleRepository(handle.adapter, SafeIndexName);
      await repo.create(new SafeIndexName({ id: 1, label: "safe" }));
      const read = await repo.read(1);
      expect(read.label).toBe("safe");
    } finally {
      await handle.cleanup();
    }
  });
});
