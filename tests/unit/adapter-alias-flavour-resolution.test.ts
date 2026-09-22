import { Adapter } from "@decaf-ts/core";
import { InternalError } from "@decaf-ts/db-decorators";
import { DrizzleAdapter, DrizzleFlavour } from "../../src";
import { createSqliteAdapter } from "../helpers/drizzleSetup";

describe("adapter alias vs flavour resolution", () => {
  it("registers the adapter under both the flavour and the explicit alias", async () => {
    const handle = await createSqliteAdapter();
    try {
      expect(Adapter.get(DrizzleFlavour)).toBe(handle.adapter);
      expect(Adapter.get(handle.adapter.alias)).toBe(handle.adapter);
      expect(handle.adapter.alias).not.toBe(DrizzleFlavour);
    } finally {
      await handle.cleanup();
    }
  });

  it("resolves the adapter by its alias", async () => {
    const handle = await createSqliteAdapter();
    try {
      expect(Adapter.get(handle.adapter.alias)).toBe(handle.adapter);
    } finally {
      await handle.cleanup();
    }
  });

  it("rejects a second adapter registered under an already used alias", async () => {
    const handle = await createSqliteAdapter();
    const alias = handle.adapter.alias;
    try {
      const db: any = (handle.adapter as any).config.db;
      expect(
        () =>
          new DrizzleAdapter(
            { dialect: "sqlite", db, client: (handle.adapter as any).config.client },
            alias
          )
      ).toThrow(InternalError);
    } finally {
      await handle.cleanup();
    }
  });

  it("unregisters the alias so it is no longer resolvable", async () => {
    const handle = await createSqliteAdapter();
    const alias = handle.adapter.alias;
    Adapter.unregister(alias);
    expect(() => Adapter.get(alias)).toThrow(InternalError);
    await handle.cleanup();
  });
});
