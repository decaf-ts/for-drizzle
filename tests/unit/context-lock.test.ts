import { Context } from "@decaf-ts/core";
import { Logging } from "@decaf-ts/logging";
import { DrizzleContextLock } from "../../src";
import {
  createMysqlAdapter,
  createSqliteAdapter,
  hasMysql,
  MYSQL_TEST_TIMEOUT_MS,
} from "../helpers/drizzleSetup";

function txContext(): Context<any> {
  return new Context().accumulate({ logger: Logging.get() } as any);
}

describe("DrizzleContextLock", () => {
  it("is returned by the adapter transactionLock()", async () => {
    const handle = await createSqliteAdapter();
    try {
      expect(handle.adapter.transactionLock()).toBeInstanceOf(
        DrizzleContextLock
      );
    } finally {
      await handle.cleanup();
    }
  });

  it("issues native BEGIN/COMMIT on the sqlite connection", async () => {
    const handle = await createSqliteAdapter();
    const db: any = (handle.adapter as any).config.db;
    const runSpy = jest.spyOn(db, "run");
    try {
      const context = txContext();
      const lock = handle.adapter.transactionLock();
      await lock.begin(context);
      await lock.commit(context);
      expect(runSpy).toHaveBeenCalledTimes(2);
      const serialized = JSON.stringify(runSpy.mock.calls);
      expect(serialized).toContain("begin");
      expect(serialized).toContain("commit");
    } finally {
      await handle.cleanup();
    }
  });

  it("issues native ROLLBACK when a transaction fails", async () => {
    const handle = await createSqliteAdapter();
    const db: any = (handle.adapter as any).config.db;
    const runSpy = jest.spyOn(db, "run");
    try {
      const context = txContext();
      const lock = handle.adapter.transactionLock();
      await lock.begin(context);
      await lock.rollback(new Error("boom"), context);
      expect(runSpy).toHaveBeenCalledTimes(2);
      const serialized = JSON.stringify(runSpy.mock.calls);
      expect(serialized).toContain("begin");
      expect(serialized).toContain("rollback");
    } finally {
      await handle.cleanup();
    }
  });

  it("does not issue a bare BEGIN on the pooled mysql dialect", async () => {
    if (!hasMysql()) {
       
      console.warn("[drizzle-tests] MYSQL_URI not set: mysql context lock not exercised");
      return;
    }
    const handle = await createMysqlAdapter();
    if (!handle) throw new Error("mysql handle unavailable");
    const db: any = (handle.adapter as any).config.db;
    const executeSpy = jest.spyOn(db, "execute");
    try {
      const context = txContext();
      const lock = handle.adapter.transactionLock();
      await lock.begin(context);
      await lock.commit(context);
      expect(executeSpy).not.toHaveBeenCalled();
    } finally {
      await handle.cleanup();
    }
  }, MYSQL_TEST_TIMEOUT_MS);
});
