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

  @query()
  existsNotByNickname(
    nickname: string,
    orderBy?: OrderBySelector<any>[],
    limit?: number,
    offset?: number
  ): Promise<boolean> {
    throw new UnsupportedError(`Method overridden by @query decorator.`);
  }

  @query()
  existsNotByAlias(
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

  // `exists(false)` is the supported negation: it selects only rows where the
  // column is null, i.e. the complement of the positive case above.
  const withoutNickname = await repo
    .select()
    .where(Condition.attribute<ExistsUser>("nickname").exists(false))
    .execute();
  expect(withoutNickname.map((u) => u.id).sort()).toEqual(["3", "4"]);
  expect(withoutNickname.every((u) => u.nickname == null)).toBe(true);

  // A column absent on every seeded row is selected in full by the negation.
  const withoutAlias = await repo
    .select()
    .where(Condition.attribute<ExistsUser>("alias").exists(false))
    .execute();
  expect(withoutAlias.map((u) => u.id).sort()).toEqual(["1", "2", "3", "4"]);

  // `existsBy<Field>` returns true when a record has the field present.
  await expect(repo.existsByName("John Smith")).resolves.toBe(true);
  await expect(repo.existsByNickname("ignored")).resolves.toBe(true);

  // `existsBy<Field>` returns false when no seeded record has the field.
  await expect(repo.existsByAlias("ignored")).resolves.toBe(false);

  // `existsNotBy<Field>` is the negated naming convention: it resolves to a
  // single `exists(false)` condition through `@query()`/MethodQueryBuilder.
  await expect(repo.existsNotByNickname("ignored")).resolves.toBe(true);
  await expect(repo.existsNotByAlias("ignored")).resolves.toBe(true);

  // A single `exists(false)` is a simple query. Forcing simple-query
  // preparation squashes the select onto the negated list-returning prepared
  // statement and still returns the full complement rows (never the boolean
  // `.limit(1)` result of the `existsNotOf` existence check).
  const forced = repo.override({ forcePrepareSimpleQueries: true });

  const forcedStatement = forced
    .select()
    .where(Condition.attribute<ExistsUser>("nickname").exists(false));
  expect((forcedStatement as any).isSimpleQuery()).toBe(true);
  const forcedWithoutNickname = await forcedStatement.execute();
  expect(Array.isArray(forcedWithoutNickname)).toBe(true);
  expect(forcedWithoutNickname.map((u) => u.id).sort()).toEqual(["3", "4"]);
  expect(forcedWithoutNickname.every((u) => u.nickname == null)).toBe(true);

  // The positive simple-query preparation keeps the full matching rows too.
  const forcedWithNickname = await forced
    .select()
    .where(Condition.attribute<ExistsUser>("nickname").exists())
    .execute();
  expect(Array.isArray(forcedWithNickname)).toBe(true);
  expect(forcedWithNickname.map((u) => u.id).sort()).toEqual(["1", "2"]);
});
