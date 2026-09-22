import { BaseModel, Context, pk, table } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { sql } from "drizzle-orm";
import {
  model,
  Model,
  ModelArg,
  required,
} from "@decaf-ts/decorator-validation";
import { DrizzleFlavour } from "../../src";
import {
  drizzleRepository,
  forEachDialect,
} from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(180000);

//
// SECURITY (regression) — cross-table dump via Statement.raw().
//
// Ported from `for-nano/tests/integration/security.raw-dump.integration.test.ts`.
// In for-nano, `CouchDBStatement.raw()` previously forwarded the caller's Mango
// query to `adapter.raw()` without the `??table` discriminator, so a repository
// bound to one table could dump every document in the database.
//
// The REAL for-drizzle post-fix contract (SAA-1612 F1 / SAA-1617) is:
// `DrizzleStatement.raw()` does NOT trust result-key filtering for isolation.
// Raw SQL strings are rejected at the statement level (the documented unrestricted
// surface is `adapter.raw()`, still gated behind `allowRawStatements`), and a
// Drizzle `SQL` object is executed only when it references the statement's own
// table and nothing else. A repository therefore cannot read another table through a
// statement, regardless of overlapping column names. The overlapping-column
// exfiltration PoC lives in `security.raw-scoping-bypass.test.ts`.
//
const PUBLIC_TABLE = "sec_raw_public";
const RESTRICTED_TABLE = "sec_raw_restricted";

@uses(DrizzleFlavour)
@table(PUBLIC_TABLE)
@model()
class RawPublic extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  publicField!: string;

  constructor(arg?: ModelArg<RawPublic>) {
    super(arg);
  }
}

@uses(DrizzleFlavour)
@table(RESTRICTED_TABLE)
@model()
class RawRestricted extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  restrictedSecret!: string;

  constructor(arg?: ModelArg<RawRestricted>) {
    super(arg);
  }
}

function buildCtx(): Context {
  return new Context().accumulate({
    allowRawStatements: true,
  } as any);
}

describe("SECURITY (regression): cross-table dump via Statement.raw()", () => {
  forEachDialect("raw is gated and own-table raw works (live)", async (handle) => {
    await handle.adapter.index(RawPublic, RawRestricted);
    const publicRepo = drizzleRepository(handle.adapter, RawPublic);
    const restrictedRepo = drizzleRepository(handle.adapter, RawRestricted);

    await restrictedRepo.create(
      new RawRestricted({ id: 1, restrictedSecret: "TOP-SECRET-VALUE" })
    );
    await publicRepo.create(new RawPublic({ id: 1, publicField: "public" }));

    const own = (await publicRepo
      .select()
      .raw(sql`select * from ${sql.raw(PUBLIC_TABLE)}`, buildCtx())) as any[];
    expect(own.length).toBe(1);
    // `own` is the public table only; the restricted secret is not part of it.
    expect(JSON.stringify(own)).not.toContain("TOP-SECRET-VALUE");

    await expect(
      publicRepo
        .select()
        .raw(sql`select * from ${sql.raw(PUBLIC_TABLE)}`, new Context())
    ).rejects.toBeDefined();

    // Raw SQL strings are not accepted at the statement level; `adapter.raw()`
    // remains the documented unrestricted raw surface.
    await expect(
      publicRepo
        .select()
        .raw(`select * from ${PUBLIC_TABLE}`, buildCtx())
    ).rejects.toBeDefined();
  });

  forEachDialect(
    "raw cannot target another table (real post-fix contract, live)",
    async (handle) => {
      // `DrizzleStatement.raw()` rejects any Drizzle `SQL` object that
      // references a table other than the statement's own table before
      // execution, so a repository for one table cannot dump another table's
      // rows through a statement.
      await handle.adapter.index(RawPublic, RawRestricted);
      const publicRepo = drizzleRepository(handle.adapter, RawPublic);
      const restrictedRepo = drizzleRepository(handle.adapter, RawRestricted);

      await restrictedRepo.create(
        new RawRestricted({ id: 1, restrictedSecret: "TOP-SECRET-VALUE" })
      );
      await publicRepo.create(new RawPublic({ id: 1, publicField: "public" }));

      await expect(
        publicRepo
          .select()
          .raw(sql`select * from ${sql.raw(RESTRICTED_TABLE)}`, buildCtx())
      ).rejects.toBeDefined();
    }
  );
});
