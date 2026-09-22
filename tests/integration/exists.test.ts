/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  BaseModel,
  column,
  Condition,
  OrderBySelector,
  pk,
  query,
  Repository,
  table,
  UnsupportedError,
} from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { Model, model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { DrizzleAdapter, DrizzleFlavour } from "../../src";
import { forEachDialect } from "../helpers/drizzleSetup";

// Decaf models must be constructible from plain objects in tests.
Model.setBuilder(Model.fromModel);

jest.setTimeout(300000);

@uses(DrizzleFlavour)
@table("exists_users")
@model()
class ExistsUser extends BaseModel {
  @pk({ type: String, generated: false })
  id!: string;

  @column("name")
  @required()
  name!: string;

  // Present on some seeded rows, absent on others.
  @column("nickname")
  nickname?: string;

  // Absent on every seeded row.
  @column("alias")
  alias?: string;

  constructor(arg?: ModelArg<ExistsUser>) {
    super(arg);
  }
}

class ExistsRepo extends Repository<ExistsUser, DrizzleAdapter> {
  constructor(adapter: DrizzleAdapter, force = false) {
    super(adapter, ExistsUser, force);
  }

  async init() {
    return this.createAll([
      new ExistsUser({ id: "1", name: "John Smith", nickname: "Johnny" }),
      new ExistsUser({ id: "2", name: "Emily Johnson", nickname: "Em" }),
      new ExistsUser({ id: "3", name: "Michael Brown" }),
      new ExistsUser({ id: "4", name: "Sarah Davis" }),
    ]);
  }

  @query()
  existsByName(
    name: string,
    orderBy?: OrderBySelector<any>[],
    limit?: number,
    offset?: number
  ): Promise<boolean> {
    throw new UnsupportedError(`Method overridden by @query decorator.`);
  }

  @query()
  existsByNickname(
    nickname: string,
    orderBy?: OrderBySelector<any>[],
    limit?: number,
    offset?: number
  ): Promise<boolean> {
    throw new UnsupportedError(`Method overridden by @query decorator.`);
  }

  @query()
  existsByAlias(
    alias: string,
    orderBy?: OrderBySelector<any>[],
    limit?: number,
    offset?: number
  ): Promise<boolean> {
    throw new UnsupportedError(`Method overridden by @query decorator.`);
  }
}

forEachDialect("Drizzle EXISTS queries", async (handle) => {
  await handle.adapter.index(ExistsUser);
  const repo = new ExistsRepo(handle.adapter, true);
  await repo.init();

  // `Condition.attribute(field).exists()` selects only rows where the column is
  // not null: `nickname` is present on two of the four seeded rows.
  const withNickname = await repo
    .select()
    .where(Condition.attribute<ExistsUser>("nickname").exists())
    .execute();
  expect(withNickname.map((u) => u.id).sort()).toEqual(["1", "2"]);
  expect(withNickname.every((u) => typeof u.nickname === "string")).toBe(true);

  // The column absent on every seeded row yields no rows.
  const withAlias = await repo
    .select()
    .where(Condition.attribute<ExistsUser>("alias").exists())
    .execute();
  expect(withAlias).toEqual([]);

  // `existsBy<Field>` returns true when a record has the field present.
  await expect(repo.existsByName("John Smith")).resolves.toBe(true);
  await expect(repo.existsByNickname("ignored")).resolves.toBe(true);

  // `existsBy<Field>` returns false when no seeded record has the field.
  await expect(repo.existsByAlias("ignored")).resolves.toBe(false);
});
