import { BaseModel, column, Context, pk, table } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
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
// SECURITY (regression) — cross-table injection via a reserved discriminator.
//
// Ported from `for-nano/tests/integration/security.cross-table-injection.integration.test.ts`.
// In for-nano a model property mapped to the internal `??table` discriminator
// (`CouchDBKeys.TABLE`) could overwrite the per-document table marker and inject
// attacker documents into another table's query results; the adapter now reserves the
// marker and rejects it on create/prepare/bulk create.
//
// for-drizzle has no per-document discriminator: every decaf model maps to its own
// SQL table, so a property mapped to `??table` becomes a physical column and cannot
// move a row between tables. The reserved-marker contract (reject the framework-owned
// `??` markers before any write) is enforced, so create/prepare/bulk create reject
// the mapping.
//
const RESERVED_DISCRIMINATOR = "??table";

const VICTIM_TABLE = "sec_xtable_victim";
const ATTACKER_TABLE = "sec_xtable_attacker";

@uses(DrizzleFlavour)
@table(VICTIM_TABLE)
@model()
class XTableVictim extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  secret!: string;

  constructor(arg?: ModelArg<XTableVictim>) {
    super(arg);
  }
}

@uses(DrizzleFlavour)
@table(ATTACKER_TABLE)
@model()
class XTableAttacker extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @column("secret")
  @required()
  payload!: string;

  // The would-be exploit: a property mapped to the reserved framework marker.
  @column(RESERVED_DISCRIMINATOR)
  @required()
  smuggledTable!: string;

  constructor(arg?: ModelArg<XTableAttacker>) {
    super(arg);
  }
}

function craft(id: number, smuggledTable = VICTIM_TABLE) {
  return new XTableAttacker({
    id,
    payload: "attacker-controlled-value",
    smuggledTable,
  });
}

describe("SECURITY (regression): cross-table injection via a reserved discriminator", () => {
  forEachDialect("table isolation holds (live)", async (handle) => {
    await handle.adapter.index(XTableVictim, XTableAttacker);
    const victimRepo = drizzleRepository(handle.adapter, XTableVictim);
    const attackerRepo = drizzleRepository(handle.adapter, XTableAttacker);

    await victimRepo.create(new XTableVictim({ id: 1, secret: "real-secret" }));

    // A reserved-marker rejection is asserted in the known-defect cases below;
    // here the write is tolerated so the isolation property can be checked.
    try {
      await attackerRepo.create(craft(7));
    } catch {
      // reserved-marker rejection would be the desired outcome
    }

    const victims = await victimRepo.select().execute();
    expect(victims.map((r) => r.id)).toEqual([1]);
    expect(JSON.stringify(victims)).not.toContain(
      "attacker-controlled-value"
    );

    const attackers = await attackerRepo.select().execute();
    expect(attackers.every((r) => r instanceof XTableAttacker)).toBe(true);
    expect(JSON.stringify(attackers)).not.toContain("real-secret");
  });

  forEachDialect(
    "create rejects a reserved discriminator mapping (live)",
    async (handle) => {
      // DrizzleAdapter rejects the framework-owned `??` markers before any write.
      await handle.adapter.index(XTableVictim, XTableAttacker);
      const attackerRepo = drizzleRepository(handle.adapter, XTableAttacker);
      await expect(attackerRepo.create(craft(7))).rejects.toThrow(/reserved/i);
    }
  );

  forEachDialect(
    "prepare rejects a reserved discriminator mapping (live)",
    async (handle) => {
      // `Adapter.prepare` is the shared gate for create and update; the
      // reserved `??table` mapping is rejected here.
      await handle.adapter.index(XTableVictim, XTableAttacker);
      expect(() =>
        handle.adapter.prepare(craft(7), new Context())
      ).toThrow(/reserved/i);
    }
  );

  forEachDialect(
    "bulk create rejects a reserved discriminator mapping (live)",
    async (handle) => {
      await handle.adapter.index(XTableVictim, XTableAttacker);
      const attackerRepo = drizzleRepository(handle.adapter, XTableAttacker);
      await expect(
        attackerRepo.createAll([craft(11), craft(12)])
      ).rejects.toThrow(/reserved/i);
    }
  );
});
