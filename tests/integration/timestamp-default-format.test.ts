import { BaseModel, pk, table } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import {
  DEFAULT_TIMESTAMP_FORMAT,
  OperationKeys,
  timestamp,
} from "@decaf-ts/db-decorators";
import { model, Model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { DrizzleFlavour } from "../../src";
import {
  createMysqlAdapter,
  drizzleRepository,
  hasMysql,
  MYSQL_TEST_TIMEOUT_MS,
} from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

// Register the decaf default timestamp format on `BaseModel` for this suite. The
// adapter overrides `@date()` for the drizzle flavour with SQL_TIMESTAMP_FORMAT,
// so `TimestampItem` (which `@uses(DrizzleFlavour)`) still persists a SQL-safe
// value. This suite asserts that adapter-side override wins.
timestamp([OperationKeys.CREATE_UPDATE], DEFAULT_TIMESTAMP_FORMAT)(
  BaseModel.prototype,
  "createdAt"
);
timestamp([OperationKeys.CREATE_UPDATE], DEFAULT_TIMESTAMP_FORMAT)(
  BaseModel.prototype,
  "updatedAt"
);

jest.setTimeout(180000);

@uses(DrizzleFlavour)
@table("ts_format_item")
@model()
class TimestampItem extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @required()
  name!: string;

  constructor(arg?: ModelArg<TimestampItem>) {
    super(arg);
  }
}

describe("timestamp format (mysql)", () => {
  if (!hasMysql()) {
     
    it("reports mysql coverage", () => {
       
      console.warn(
        "[drizzle-tests] MYSQL_URI not set: mysql timestamp defect not exercised"
      );
    });
    return;
  }

  it(
    "normalises the decaf default timestamp format to a SQL-safe value on mysql",
    async () => {
      // Even though `BaseModel` is re-registered with decaf's default
      // "dd/MM/yyyy HH:mm:ss:S" format above, the adapter's `@date()` override
      // for DrizzleFlavour forces SQL_TIMESTAMP_FORMAT ("yyyy-MM-dd HH:mm:ss"),
      // so MySQL DATETIME(3) accepts the value.
      const handle = await createMysqlAdapter();
      if (!handle) throw new Error("mysql handle unavailable");
      try {
        await handle.adapter.index(TimestampItem);
        const repo = drizzleRepository(handle.adapter, TimestampItem);
        const created = await repo.create(
          new TimestampItem({ id: 1, name: "default-format" })
        );
        expect(created.id).toBe(1);
      } finally {
        await handle.cleanup();
      }
    },
    MYSQL_TEST_TIMEOUT_MS
  );
});
