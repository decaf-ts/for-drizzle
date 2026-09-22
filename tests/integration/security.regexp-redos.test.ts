import { BaseModel, Condition, pk, table } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { model, Model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { DrizzleFlavour } from "../../src";
import { createSqliteAdapter, drizzleRepository } from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(180000);

//
// SECURITY (regression, SAA-1612 F2) — ReDoS through the SQLite `regexp`
// user-defined function backing `Operator.REGEXP`.
//
// Pre-fix the UDF was `new RegExp(pattern).test(value)` executed synchronously
// on the Node event loop; `(a+)+b` against 28 `a`s blocked the loop for ~12.5s
// per call (CWE-1333). Post-fix (SAA-1617) the UDF uses Google RE2, which is
// linear-time, so catastrophic patterns can no longer cause backtracking blowups,
// and RE2-only constructs such as lookaround are rejected outright.
//
const REDOS_ROW = "a".repeat(28);
const CATASTROPHIC_PATTERN = "(a+)+b";
// Generous CI guard: the pre-fix engine needs ~12.5s, the RE2 engine answers in
// well under 100ms, so 5s cleanly separates the two without being flaky.
const WALL_CLOCK_GUARD_MS = 5000;

@uses(DrizzleFlavour)
@table("sec_redos_item")
@model()
class RedosItem extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  name!: string;

  constructor(arg?: ModelArg<RedosItem>) {
    super(arg);
  }
}

describe("SECURITY (regression, F2): SQLite REGEXP ReDoS boundedness", () => {
  let handle: Awaited<ReturnType<typeof createSqliteAdapter>>;
  let repo: ReturnType<typeof drizzleRepository<RedosItem>>;

  beforeAll(async () => {
    handle = await createSqliteAdapter();
    await handle.adapter.index(RedosItem);
    repo = drizzleRepository(handle.adapter, RedosItem);
    await repo.create(new RedosItem({ id: 1, name: REDOS_ROW }));
  });

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  it("does not block the event loop on a catastrophic backtracking pattern", async () => {
    const start = performance.now();
    const result = await repo
      .select()
      .where(Condition.attribute<RedosItem>("name").regexp(CATASTROPHIC_PATTERN))
      .execute();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(WALL_CLOCK_GUARD_MS);
    // `(a+)+b` cannot match a value made only of `a`s.
    expect(result.length).toBe(0);
  });

  it("rejects RE2-unsupported constructs (lookaround) instead of backtracking", async () => {
    const start = performance.now();
    let rejected = false;
    try {
      await repo
        .select()
        .where(Condition.attribute<RedosItem>("name").regexp("(?=a)a"))
        .execute();
    } catch {
      rejected = true;
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(WALL_CLOCK_GUARD_MS);
    expect(rejected).toBe(true);
  });

  it("still performs ordinary REGEXP matches (positive control)", async () => {
    const matches = await repo
      .select()
      .where(Condition.attribute<RedosItem>("name").regexp("^a+$"))
      .execute();
    expect(matches.map((r) => r.id)).toEqual([1]);
  });
});
