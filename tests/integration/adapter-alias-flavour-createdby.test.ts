// Golden rule: the adapter (and its decoration overrides) must load before any
// model module so `Decoration.flavouredAs("drizzle")` overrides are registered
// before the models below are decorated.
import { DrizzleAdapter, DrizzleFlavour } from "../../src";
import {
  Adapter,
  Context,
  createdBy,
  pk,
  Repository,
} from "@decaf-ts/core";
Adapter.setCurrent(DrizzleFlavour);
DrizzleAdapter.decoration();
import { uses } from "@decaf-ts/decoration";
import {
  Model,
  model,
  ModelArg,
  required,
} from "@decaf-ts/decorator-validation";
import Database from "better-sqlite3";
import { drizzle as sqliteDrizzle } from "drizzle-orm/better-sqlite3";

@uses(DrizzleFlavour)
@model()
class StandardDrizzleModel extends Model {
  @pk({ type: String })
  id!: string;

  @required()
  name!: string;

  constructor(arg?: ModelArg<StandardDrizzleModel>) {
    super(arg);
  }
}

@uses(DrizzleFlavour)
@model()
class TasksAliasModel extends Model {
  @pk({ type: String })
  id!: string;

  @required()
  name!: string;

  constructor(arg?: ModelArg<TasksAliasModel>) {
    super(arg);
  }
}

@uses(DrizzleFlavour)
@model()
class OwnedDrizzleModel extends Model {
  @pk({ type: String })
  id!: string;

  @required()
  name!: string;

  @createdBy()
  createdBy!: string;

  constructor(arg?: ModelArg<OwnedDrizzleModel>) {
    super(arg);
  }
}

function sqliteAdapter(alias?: string): {
  adapter: DrizzleAdapter;
  sqlite: Database;
} {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const adapter = new DrizzleAdapter(
    { dialect: "sqlite", db: sqliteDrizzle(sqlite) as any, client: sqlite },
    alias
  );
  return { adapter, sqlite };
}

describe("for-drizzle adapter alias vs flavour createdBy resolution", () => {
  let standard: ReturnType<typeof sqliteAdapter>;
  let tasks: ReturnType<typeof sqliteAdapter>;

  beforeAll(async () => {
    standard = sqliteAdapter();
    tasks = sqliteAdapter("tasks");
    await standard.adapter.initialize();
    await tasks.adapter.initialize();
    await standard.adapter.index(StandardDrizzleModel);
    await tasks.adapter.index(TasksAliasModel);
    await standard.adapter.index(OwnedDrizzleModel);
  });

  afterAll(async () => {
    await tasks?.adapter.shutdown().catch(() => undefined);
    await standard?.adapter.shutdown().catch(() => undefined);
    standard?.sqlite.close();
    tasks?.sqlite.close();
  });

  it("binds repositories to the default and aliased adapters", () => {
    const standardRepo = Repository.forModel(
      StandardDrizzleModel,
      standard.adapter.alias
    );
    const tasksRepo = Repository.forModel(
      TasksAliasModel,
      tasks.adapter.alias
    );

    expect(standard.adapter.alias).toBe(DrizzleFlavour);
    expect((standardRepo as any).adapter).toBe(standard.adapter);
    expect(tasks.adapter.alias).toBe("tasks");
    expect((tasksRepo as any).adapter).toBe(tasks.adapter);
    expect(tasksRepo).not.toBe(standardRepo);
  });

  it("persists through both the default and aliased adapters", async () => {
    const standardRepo = Repository.forModel(
      StandardDrizzleModel,
      standard.adapter.alias
    );
    const tasksRepo = Repository.forModel(TasksAliasModel, tasks.adapter.alias);

    const standardCreated = await standardRepo.create(
      new StandardDrizzleModel({
        id: `std-${Date.now()}`,
        name: "standard",
      })
    );
    const tasksCreated = await tasksRepo.create(
      new TasksAliasModel({ id: `tsk-${Date.now()}`, name: "tasks" })
    );

    expect(standardCreated.name).toBe("standard");
    expect(tasksCreated.name).toBe("tasks");
  });

  it("resolves createdBy from the context user", async () => {
    // DrizzleAdapter registers createdBy/updatedBy handlers for DrizzleFlavour in
    // its `decoration()` override. The handler reads the `user` property from the
    // operation context, so a context user must be supplied on create.
    const repo = Repository.forModel(
      OwnedDrizzleModel,
      standard.adapter.alias
    );
    const context = new Context().accumulate({
      user: "context-user",
    } as any);
    const created = await repo.create(
      new OwnedDrizzleModel({
        id: `std-${Date.now()}`,
        name: "standard",
      }),
      context
    );
    expect(created.createdBy).toBe("context-user");
  });
});
