import { Dispatch } from "@decaf-ts/core";
import type { Observer } from "@decaf-ts/core";
import { DrizzleAdapter } from "../../src";
import { createSqliteAdapter } from "../helpers/drizzleSetup";
import { TestModel } from "../TestModel";

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

const observer = (): Observer => ({
  refresh: () => Promise.resolve(),
});

describe("Dispatch", () => {
  it("is what the adapter builds", async () => {
    const handle = await createSqliteAdapter();
    try {
      const dispatch = (handle.adapter as any).Dispatch();
      expect(dispatch).toBeInstanceOf(Dispatch);
      expect(dispatch.adapter).toBeUndefined();
      expect(dispatch.initialized).toBe(false);
    } finally {
      await handle.cleanup();
    }
  });

  it("initializes lazily once an observer attaches to the adapter", async () => {
    const handle = await createSqliteAdapter([TestModel]);
    try {
      expect((handle.adapter as any).dispatch).toBeUndefined();

      const unobserve = handle.adapter.observe(observer());
      const dispatch = (handle.adapter as any).dispatch as Dispatch<DrizzleAdapter>;
      expect(dispatch).toBeInstanceOf(Dispatch);

      await waitFor(() => dispatch.initialized);
      expect(dispatch.adapter).toBe(handle.adapter);

      unobserve();
    } finally {
      await handle.cleanup();
    }
  });

  it("keeps the dispatch instance after the last observer detaches", async () => {
    const handle = await createSqliteAdapter([TestModel]);
    try {
      const unobserve = handle.adapter.observe(observer());
      const dispatch = (handle.adapter as any).dispatch as Dispatch<DrizzleAdapter>;
      await waitFor(() => dispatch.initialized);

      unobserve();
      expect((handle.adapter as any).dispatch).toBe(dispatch);
      expect(dispatch.adapter).toBeUndefined();
    } finally {
      await handle.cleanup();
    }
  });

  it("revives a disposed dispatch when the adapter is re-initialized", async () => {
    const handle = await createSqliteAdapter([TestModel]);
    try {
      const unobserve = handle.adapter.observe(observer());
      const dispatch = (handle.adapter as any).dispatch as Dispatch<DrizzleAdapter>;
      await waitFor(() => dispatch.initialized);

      await handle.adapter.shutdown();
      expect(dispatch.disposedUntilRevived).toBe(true);

      await handle.adapter.initialize();
      expect(dispatch.disposedUntilRevived).toBe(false);

      unobserve();
    } finally {
      await handle.cleanup();
    }
  });

  it("rejects observing a non adapter", () => {
    const dispatch = new Dispatch();
    expect(() => dispatch.observe({} as any)).toThrow();
  });
});
