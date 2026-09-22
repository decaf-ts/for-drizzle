import { BaseModel, column, Context, pk, table } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { sql } from "drizzle-orm";
import {
  model,
  Model,
  ModelArg,
  required,
} from "@decaf-ts/decorator-validation";
import { DrizzleFlavour } from "../../src";
import { createSqliteAdapter, drizzleRepository } from "../helpers/drizzleSetup";
import type { DrizzleTestHandle } from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(180000);

//
// SECURITY (regression, SAA-1612 F1) — overlapping-column cross-table raw
// exfiltration through `DrizzleStatement.raw()`.
//
// Reviewer's executed pre-fix PoC: an attacker model whose decoy property maps to
// the victim's secret column name could call
// `attackerRepo.select().raw("select * from poc_victim", ctx)` with
// `allowRawStatements: true` and receive the victim's full rows — the statement
// level `raw()` forwarded the string straight to `adapter.raw()` and only filtered
// result keys, so the overlapping column name survived the filter.
//
// Post-fix contract (SAA-1617): `DrizzleStatement.raw()` rejects raw SQL strings
// outright (the documented unrestricted surface is `adapter.raw()`) and rejects any
// Drizzle `SQL` object that references a table other than the statement's own
// table. The overlap between the attacker's column names and the victim's is
// irrelevant: nothing from the victim table may reach the caller.
//
const ATTACKER_TABLE = "poc_attacker";
const VICTIM_TABLE = "poc_victim";
const VICTIM_SECRET = "poc-victim-secret-value";

@uses(DrizzleFlavour)
@table(ATTACKER_TABLE)
@model()
class PocAttacker extends BaseModel {
  @pk({ type: Number })
  id!: number;

  // Decoy: the attacker's property is mapped onto the victim's secret column
  // name, so the pre-fix result-key filtering would have accepted the leaked
  // victim column as if it belonged to the attacker model.
  @column("victim_secret")
  decoy!: string;

  constructor(arg?: ModelArg<PocAttacker>) {
    super(arg);
  }
}

@uses(DrizzleFlavour)
@table(VICTIM_TABLE)
@model()
class PocVictim extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @column("victim_secret")
  @required()
  victimSecret!: string;

  constructor(arg?: ModelArg<PocVictim>) {
    super(arg);
  }
}

function rawCtx(): Context {
  return new Context().accumulate({
    allowRawStatements: true,
  } as any);
}

describe("SECURITY (regression, F1): cross-table raw scoping bypass", () => {
  let handle: DrizzleTestHandle;
  let attackerRepo: ReturnType<typeof drizzleRepository<PocAttacker>>;
  let victimRepo: ReturnType<typeof drizzleRepository<PocVictim>>;

  beforeAll(async () => {
    handle = await createSqliteAdapter();
    await handle.adapter.index(PocAttacker, PocVictim);
    attackerRepo = drizzleRepository(handle.adapter, PocAttacker);
    victimRepo = drizzleRepository(handle.adapter, PocVictim);
    await victimRepo.create(
      new PocVictim({ id: 1, victimSecret: VICTIM_SECRET })
    );
    await attackerRepo.create(new PocAttacker({ id: 1, decoy: "attacker-value" }));
  });

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  it("rejects the reviewer's raw-SQL-string PoC (string raw is not a statement surface)", async () => {
    await expect(
      attackerRepo
        .select()
        .raw(`select * from ${VICTIM_TABLE}`, rawCtx())
    ).rejects.toBeDefined();
  });

  it("rejects a foreign-table Drizzle SQL object", async () => {
    await expect(
      attackerRepo
        .select()
        .raw(sql`select * from ${sql.raw(VICTIM_TABLE)}`, rawCtx())
    ).rejects.toBeDefined();
  });

  it("does not expose the victim secret through any rejected raw call", async () => {
    const attempts = [
      () => attackerRepo.select().raw(`select * from ${VICTIM_TABLE}`, rawCtx()),
      () =>
        attackerRepo
          .select()
          .raw(sql`select * from ${sql.raw(VICTIM_TABLE)}`, rawCtx()),
    ];
    for (const attempt of attempts) {
      let leaked: unknown;
      try {
        leaked = await attempt();
      } catch {
        leaked = undefined;
      }
      expect(JSON.stringify(leaked ?? null)).not.toContain(VICTIM_SECRET);
    }
  });

  it("still allows an own-table Drizzle SQL object raw query (positive control)", async () => {
    const rows = (await attackerRepo
      .select()
      .raw(sql`select * from ${sql.raw(ATTACKER_TABLE)}`, rawCtx())) as any[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(1);
    expect(JSON.stringify(rows)).not.toContain(VICTIM_SECRET);
  });

  it("requires allowRawStatements even for an own-table raw query", async () => {
    await expect(
      attackerRepo
        .select()
        .raw(sql`select * from ${sql.raw(ATTACKER_TABLE)}`, new Context())
    ).rejects.toBeDefined();
  });

  it("keeps the victim row readable only through the victim repository", async () => {
    const victim = await victimRepo.read(1);
    expect(victim.victimSecret).toBe(VICTIM_SECRET);
  });
});
