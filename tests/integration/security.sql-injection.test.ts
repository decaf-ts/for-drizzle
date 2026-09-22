import {
  BaseModel,
  Condition,
  pk,
  table,
} from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { model, Model, ModelArg, required } from "@decaf-ts/decorator-validation";
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

jest.setTimeout(120000);

@uses(DrizzleFlavour)
@table("sec_public")
@model()
class SecPublic extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  name!: string;

  constructor(arg?: ModelArg<SecPublic>) {
    super(arg);
  }
}

@uses(DrizzleFlavour)
@table("sec_restricted")
@model()
class SecRestricted extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  secret!: string;

  constructor(arg?: ModelArg<SecRestricted>) {
    super(arg);
  }
}

const INJECTION = "'; DROP TABLE sec_restricted;--";

function injectionSuite(
  label: string,
  create: () => Promise<DrizzleTestHandle | undefined>,
  timeout: number = MYSQL_TEST_TIMEOUT_MS
) {
  describe(label, () => {
    let handle: DrizzleTestHandle;

    beforeAll(async () => {
      handle = (await create()) as DrizzleTestHandle;
      await handle.adapter.index(SecPublic, SecRestricted);
      const restricted = drizzleRepository(handle.adapter, SecRestricted);
      const publicRepo = drizzleRepository(handle.adapter, SecPublic);
      await restricted.create(
        new SecRestricted({ id: 1, secret: "TOP-SECRET-VALUE" })
      );
      await publicRepo.create(new SecPublic({ id: 1, name: INJECTION }));
    }, timeout);

    afterAll(async () => {
      if (handle) await handle.cleanup();
    });

    it("treats an injection payload as a literal string value", async () => {
      const publicRepo = drizzleRepository(handle.adapter, SecPublic);
      const results = await publicRepo
        .select()
        .where(Condition.attribute("name").eq(INJECTION))
        .execute();
      expect(results.length).toBe(1);
      expect(results[0].name).toBe(INJECTION);
    });

    it("does not drop or leak other tables when a payload is used", async () => {
      const restricted = drizzleRepository(handle.adapter, SecRestricted);
      const read = await restricted.read(1);
      expect(read.secret).toBe("TOP-SECRET-VALUE");

      const publicRepo = drizzleRepository(handle.adapter, SecPublic);
      const rows = await publicRepo.select().execute();
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe(INJECTION);
    });

    it("scopes a repository query to its own table only", async () => {
      const publicRepo = drizzleRepository(handle.adapter, SecPublic);
      const rows = await publicRepo.select().execute();
      expect(rows.every((r) => r instanceof SecPublic)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("TOP-SECRET-VALUE");
    });
  });
}

injectionSuite("SECURITY: SQL injection through condition values (sqlite)", () =>
  createSqliteAdapter()
);

if (hasMysql()) {
  injectionSuite(
    "SECURITY: SQL injection through condition values (mysql)",
    () => createMysqlAdapter()
  );
} else {
  console.warn(
    "[drizzle-tests] MYSQL_URI not set: mysql SQL-injection coverage not exercised"
  );
}

if (hasPostgres()) {
  injectionSuite(
    "SECURITY: SQL injection through condition values (postgres)",
    () => createPostgresAdapter(),
    POSTGRES_TEST_TIMEOUT_MS
  );
} else {
  console.warn(
    "[drizzle-tests] POSTGRES_URI not set: postgres SQL-injection coverage not exercised"
  );
}
