import Database from "better-sqlite3";
import { drizzle as sqliteDrizzle } from "drizzle-orm/better-sqlite3";
import { BaseModel, Dispatch, pk, Repository, table } from "@decaf-ts/core";
import type { Observer } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { Model, model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { DrizzleAdapter, DrizzleFlavour } from "../../src";
import { createSqliteAdapter } from "../helpers/drizzleSetup";
import type { DrizzleTestHandle } from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(300000);

@uses(DrizzleFlavour)
@table("dispatch_items")
@model()
class DispatchItem extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @required()
  name!: string;

  constructor(arg?: ModelArg<DispatchItem>) {
    super(arg);
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition was not met before the timeout");
}

describe("Dispatch integration", () => {
  let handle: DrizzleTestHandle;
  let repo: Repository<DispatchItem, DrizzleAdapter>;

  beforeAll(async () => {
    handle = await createSqliteAdapter([DispatchItem]);
    repo = new Repository(handle.adapter, DispatchItem);
  });

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  it("marks the dispatch initialized when observing and detaches when closed", async () => {
    const observer: Observer = { refresh: () => Promise.resolve() };
    const unobserve = repo.observe(observer);

    const dispatch = (handle.adapter as any).dispatch as Dispatch<DrizzleAdapter>;
    expect(dispatch).toBeDefined();
    expect(dispatch).toBeInstanceOf(Dispatch);
    await waitFor(() => dispatch.initialized);
    expect(dispatch.adapter).toBe(handle.adapter);

    unobserve();
    await waitFor(() => dispatch.adapter === undefined);
    expect((handle.adapter as any).dispatch).toBe(dispatch);
  });

  it("reinitializes the dispatch when new observers attach", async () => {
    const firstUnobserve = repo.observe({ refresh: () => Promise.resolve() });
    const dispatch = (handle.adapter as any).dispatch as Dispatch<DrizzleAdapter>;
    await waitFor(() => dispatch.initialized);
    firstUnobserve();
    await waitFor(() => dispatch.adapter === undefined);

    const secondUnobserve = repo.observe({
      refresh: () => Promise.resolve(),
    });
    await waitFor(() => dispatch.adapter === handle.adapter);
    expect(dispatch.initialized).toBe(true);
    secondUnobserve();
  });

  it("notifies observers after a create and persists the row", async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const unobserve = repo.observe({ refresh });
    const created = await repo.create(
      new DispatchItem({ id: 1, name: "observed" })
    );
    expect(created.id).toBe(1);

    // the write actually reached the database...
    const read = await repo.read(1);
    expect(read.name).toBe("observed");

    // ...and the adapter notified the observer with the model, event and id.
    await waitFor(() => refresh.mock.calls.length > 0);
    const [model, event, id] = refresh.mock.calls[0];
    expect(model).toBe(DispatchItem);
    expect(String(event).toLowerCase()).toContain("create");
    expect(id).toBe(1);
    unobserve();
  });

  it("notifies observers after bulk creates", async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const unobserve = repo.observe({ refresh });
    await repo.createAll([
      new DispatchItem({ id: 3, name: "bulk-a" }),
      new DispatchItem({ id: 4, name: "bulk-b" }),
    ]);

    const rows = (await handle.adapter.raw(
      'SELECT "id" FROM "dispatch_items" WHERE "id" IN (3, 4)',
      true
    )) as any[];
    const ids = rows.map((r) => r.id ?? r.ID).sort();
    expect(ids).toEqual([3, 4]);

    await waitFor(() => refresh.mock.calls.length > 0);
    unobserve();
  });

  it("notifies observers after update and delete", async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const unobserve = repo.observe({ refresh });
    await repo.create(new DispatchItem({ id: 5, name: "before" }));
    await waitFor(() => refresh.mock.calls.length > 0);

    const created = await repo.read(5);
    created.name = "after";
    await repo.update(created);
    await waitFor(() =>
      refresh.mock.calls.some((call) =>
        String(call[1]).toLowerCase().includes("update")
      )
    );

    await repo.delete(5);
    await waitFor(() =>
      refresh.mock.calls.some((call) =>
        String(call[1]).toLowerCase().includes("delete")
      )
    );
    await expect(repo.read(5)).rejects.toBeDefined();
    unobserve();
  });

  it("supports proxied adapters configured via for()", async () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = sqliteDrizzle(sqlite);
    const proxiedAdapter = handle.adapter.for({
      dialect: "sqlite",
      db: db as any,
      client: sqlite,
    });
    await proxiedAdapter.index(DispatchItem);
    const proxiedRepo = new Repository(proxiedAdapter, DispatchItem, true);

    const created = await proxiedRepo.create(
      new DispatchItem({ id: 2, name: "proxied" })
    );
    expect(created).toBeDefined();

    const read = await proxiedRepo.read(2);
    expect(read.name).toBe("proxied");
    expect(read.equals(created)).toBe(true);

    await proxiedRepo.delete(2);
    sqlite.close();
  });
});
