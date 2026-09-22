import { Model } from "@decaf-ts/decorator-validation";
import { repository, Repository } from "@decaf-ts/core";
import { DrizzleAdapter } from "../../src";
import { TestModel } from "../TestModel";
import {
  createMysqlAdapter,
  createPostgresAdapter,
  createSqliteAdapter,
  hasMysql,
  hasPostgres,
  MYSQL_TEST_TIMEOUT_MS,
  POSTGRES_TEST_TIMEOUT_MS,
} from "../helpers/drizzleSetup";
import type { DrizzleTestHandle } from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(300000);

/**
 * Runs the ported for-nano repository suite against one dialect. The handle is
 * created once per dialect and each case runs as its own `it`. `TestModel` is
 * decorated with `@uses(DrizzleFlavour)`, and the first adapter created in the
 * process registers itself under that flavour, so `Repository.forModel(TestModel)`
 * resolves without an explicit alias (mirroring the for-nano case).
 */
function dialectSuite(
  label: string,
  create: () => Promise<DrizzleTestHandle | undefined>,
  timeout: number = MYSQL_TEST_TIMEOUT_MS
): void {
  describe(label, () => {
    let handle: DrizzleTestHandle;

    beforeAll(async () => {
      handle = (await create()) as DrizzleTestHandle;
      await handle.adapter.index(TestModel);
    }, timeout);

    afterAll(async () => {
      if (handle) await handle.cleanup();
    });

    it("instantiates via constructor", () => {
      const repo: Repository<TestModel, DrizzleAdapter> = new Repository(
        handle.adapter,
        TestModel
      );
      expect(repo).toBeDefined();
      expect(repo).toBeInstanceOf(Repository);
    });

    it("instantiates via Repository.forModel with @uses decorator on model", () => {
      const repo = Repository.forModel(TestModel);
      expect(repo).toBeDefined();
      expect(repo).toBeInstanceOf(Repository);
      expect((repo as any).adapter).toBeDefined();
    });

    it("gets injected when using @repository", () => {
      class TestClass {
        @repository(TestModel)
        repo!: Repository<TestModel, DrizzleAdapter>;
      }

      const testClass = new TestClass();
      expect(testClass).toBeDefined();
      expect(testClass.repo).toBeDefined();
      expect(testClass.repo).toBeInstanceOf(Repository);
    });
  });
}

dialectSuite("repositories on the drizzle adapter (sqlite)", () =>
  createSqliteAdapter()
);

if (hasMysql()) {
  dialectSuite("repositories on the drizzle adapter (mysql)", () =>
    createMysqlAdapter()
  );
} else {
  console.warn(
    "[drizzle-tests] MYSQL_URI not set: mysql repository coverage not exercised"
  );
}

if (hasPostgres()) {
  dialectSuite(
    "repositories on the drizzle adapter (postgres)",
    () => createPostgresAdapter(),
    POSTGRES_TEST_TIMEOUT_MS
  );
} else {
  console.warn(
    "[drizzle-tests] POSTGRES_URI not set: postgres repository coverage not exercised"
  );
}
