import { BaseModel, pk, sequence, version } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { Model, model, type ModelArg } from "@decaf-ts/decorator-validation";
import { DrizzleFlavour } from "../../src";
import {
  createMysqlAdapter,
  createSqliteAdapter,
  drizzleRepository,
  hasMysql,
  MYSQL_TEST_TIMEOUT_MS,
} from "../helpers/drizzleSetup";
import type { DrizzleTestHandle } from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(300000);

@uses(DrizzleFlavour)
@model()
class PersistentVersionModel extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @version(true)
  version!: number;

  constructor(arg?: ModelArg<PersistentVersionModel>) {
    super(arg);
  }
}

@uses(DrizzleFlavour)
@model()
class SequencePerInstanceModel extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @sequence({ type: Number })
  step!: number;

  constructor(arg?: ModelArg<SequencePerInstanceModel>) {
    super(arg);
  }
}

/**
 * Runs the ported for-nano sequence/version suite against one dialect. The
 * handle is created once per dialect and each case runs as its own `it` so the
 * create and update/re-create paths are both covered per dialect.
 */
function dialectSuite(
  label: string,
  create: () => Promise<DrizzleTestHandle | undefined>
): void {
  describe(label, () => {
    let handle: DrizzleTestHandle;

    beforeAll(async () => {
      handle = (await create()) as DrizzleTestHandle;
      await handle.adapter.index(
        PersistentVersionModel,
        SequencePerInstanceModel
      );
    }, MYSQL_TEST_TIMEOUT_MS);

    afterAll(async () => {
      if (handle) await handle.cleanup();
    });

    it("@version(true) assigns version 1 on create", async () => {
      const repo = drizzleRepository(handle.adapter, PersistentVersionModel);

      const first = await repo.create(new PersistentVersionModel({ id: 101 }));
      expect(first.version).toBe(1);

      const second = await repo.create(new PersistentVersionModel({ id: 102 }));
      expect(second.version).toBe(1);
    });

    it("@version(true) increments across update/delete/recreate for the same pk", async () => {
      // Regression guard for SAA-1563: `SequenceModel.current` is persisted in a
      // TEXT/VARCHAR column, so `DrizzleAdapter.update` returns the DB-read value
      // as a string. `DrizzleSequence.increment` re-parses it through core
      // `Sequence.parse` so `@version` validation receives the declared type.
      const repo = drizzleRepository(handle.adapter, PersistentVersionModel);

      const created = await repo.create(new PersistentVersionModel({ id: 1 }));
      expect(created.version).toBe(1);

      const updated = await repo.update(
        new PersistentVersionModel({ ...created })
      );
      expect(updated.version).toBe(2);

      await repo.delete(updated.id);

      const recreated = await repo.create(new PersistentVersionModel({ id: 1 }));
      expect(recreated.version).toBe(3);

      const another = await repo.create(new PersistentVersionModel({ id: 2 }));
      expect(another.version).toBe(1);
    });

    it("@sequence() is per-model-instance (pk + property), not global per class", async () => {
      const repo = drizzleRepository(handle.adapter, SequencePerInstanceModel);

      let a = await repo.create(new SequencePerInstanceModel({ id: 1 }));
      let b = await repo.create(new SequencePerInstanceModel({ id: 2 }));

      expect(a.step).toBe(1);
      expect(b.step).toBe(1);

      a = await repo.delete(1);
      b = await repo.update(b);

      expect(a.step).toBe(1);
      expect(b.step).toBe(1);
    });

    it("@sequence() increments on re-create after delete", async () => {
      // Regression guard for SAA-1563: re-creating a pk whose backing sequence
      // already exists reads the persisted counter back from the TEXT column;
      // `DrizzleSequence.increment` re-parses it so the numeric `@sequence`
      // validation receives the declared type.
      const repo = drizzleRepository(handle.adapter, SequencePerInstanceModel);

      const first = await repo.create(new SequencePerInstanceModel({ id: 11 }));
      const b = await repo.create(new SequencePerInstanceModel({ id: 12 }));
      expect(first.step).toBe(1);
      expect(b.step).toBe(1);

      await repo.delete(11);
      const a = await repo.create(new SequencePerInstanceModel({ id: 11 }));
      expect(a.step).toBe(2);

      delete b.step;
      const updatedB = await repo.update(b);
      expect(updatedB.step).toBe(1);
    });
  });
}

dialectSuite("core decorators on the drizzle adapter (sqlite)", () =>
  createSqliteAdapter()
);

if (hasMysql()) {
  dialectSuite("core decorators on the drizzle adapter (mysql)", () =>
    createMysqlAdapter()
  );
} else {
  console.warn(
    "[drizzle-tests] MYSQL_URI not set: mysql sequence/version coverage not exercised"
  );
}
