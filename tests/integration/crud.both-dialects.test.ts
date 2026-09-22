import { BaseModel, column, pk, table, unique } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { NotFoundError } from "@decaf-ts/db-decorators";
import {
  maxlength,
  Model,
  model,
  ModelArg,
  required,
} from "@decaf-ts/decorator-validation";
import { DrizzleFlavour } from "../../src";
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
@table("crud_item")
@model()
class CrudItem extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @column("item_name")
  @required()
  name!: string;

  @column("item_code")
  @unique()
  @maxlength(9)
  @required()
  code!: string;

  constructor(arg?: ModelArg<CrudItem>) {
    super(arg);
  }
}

@uses(DrizzleFlavour)
@table("manual_item")
@model()
class ManualItem extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @column("item_name")
  @required()
  name!: string;

  constructor(arg?: ModelArg<ManualItem>) {
    super(arg);
  }
}

function crudSuite(
  label: string,
  create: () => Promise<DrizzleTestHandle | undefined>,
  timeout: number = MYSQL_TEST_TIMEOUT_MS
) {
  describe(label, () => {
    let handle: DrizzleTestHandle;

    beforeAll(async () => {
      handle = (await create()) as DrizzleTestHandle;
      await handle.adapter.index(CrudItem, ManualItem);
    }, timeout);

    afterAll(async () => {
      if (handle) await handle.cleanup();
    });

    it("creates, reads, updates and deletes a record", async () => {
      const repo = drizzleRepository(handle.adapter, CrudItem);
      const created = await repo.create(
        new CrudItem({ name: "alpha", code: "123456789" })
      );
      expect(created.id).toBeDefined();
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBeDefined();

      const read = await repo.read(created.id);
      expect(read.name).toBe("alpha");
      expect(read.code).toBe("123456789");

      read.name = "beta";
      const updated = await repo.update(read);
      expect(updated.name).toBe("beta");

      const found = await repo.findBy("name", "beta");
      expect(found.length).toBe(1);
      expect(found[0].id).toBe(created.id);

      const all = await repo.select().execute();
      expect(all.length).toBe(1);
      expect(all[0].id).toBe(created.id);

      await repo.delete(created.id);
      await expect(repo.read(created.id)).rejects.toBeInstanceOf(
        NotFoundError
      );
      expect((await repo.select().execute()).length).toBe(0);
    });

    it("bulk creates, reads and deletes records with explicit ids", async () => {
      const repo = drizzleRepository(handle.adapter, ManualItem);
      const models = Object.keys(new Array(5).fill(0)).map(
        (_, i) =>
          new ManualItem({
            id: i + 1,
            name: `bulk_${i}`,
          })
      );
      const created = await repo.createAll(models);
      expect(created.length).toBe(5);

      const readAll = await repo.readAll(created.map((m) => m.id));
      expect(readAll.length).toBe(5);

      await repo.deleteAll(created.map((m) => m.id));
      expect((await repo.select().execute()).length).toBe(0);
    });

    it("bulk createAll on generated numeric primary keys", async () => {
      // Regression guard for SAA-1563: the SequenceModel.current column is
      // translated as TEXT, so DrizzleSequence.increment must re-parse the
      // persisted counter before Sequence.range compares it to numeric entries.
      const repo = drizzleRepository(handle.adapter, CrudItem);
      const created = await repo.createAll(
        Object.keys(new Array(3).fill(0)).map(
          (_, i) => new CrudItem({ name: `gen_${i}`, code: `10000000${i}` })
        )
      );
      expect(created.length).toBe(3);
    });
  });
}

crudSuite("repository CRUD (sqlite)", () => createSqliteAdapter());
if (hasMysql()) {
  crudSuite("repository CRUD (mysql)", () => createMysqlAdapter());
} else {
  console.warn(
    "[drizzle-tests] MYSQL_URI not set: mysql repository CRUD not exercised"
  );
}

if (hasPostgres()) {
  crudSuite(
    "repository CRUD (postgres)",
    () => createPostgresAdapter(),
    POSTGRES_TEST_TIMEOUT_MS
  );
} else {
  console.warn(
    "[drizzle-tests] POSTGRES_URI not set: postgres repository CRUD not exercised"
  );
}
