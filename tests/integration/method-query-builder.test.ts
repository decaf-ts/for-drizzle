/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  BaseModel,
  column,
  index,
  OrderBySelector,
  OrderDirection,
  pk,
  query,
  QueryError,
  Repository,
  table,
  UnsupportedError,
} from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import {
  maxlength,
  min,
  minlength,
  Model,
  model,
  ModelArg,
  required,
} from "@decaf-ts/decorator-validation";
import { DrizzleAdapter, DrizzleFlavour } from "../../src";
import {
  createSqliteAdapter,
  forEachDialect,
} from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(300000);

@uses(DrizzleFlavour)
@table("method_query_users")
@model()
class MethodUser extends BaseModel {
  @pk({ type: String, generated: false })
  id!: string;

  @column("name")
  @index([OrderDirection.ASC, OrderDirection.DSC])
  @required()
  name!: string;

  @column("nif")
  @minlength(9)
  @maxlength(9)
  @required()
  nif!: string;

  @column("age")
  @index([OrderDirection.DSC, OrderDirection.ASC])
  @min(20)
  @required()
  age!: number;

  @column("country")
  @minlength(2)
  @maxlength(2)
  @required()
  country!: string;

  @column("state")
  @minlength(2)
  @maxlength(2)
  @required()
  state!: string;

  @column("active")
  @index([OrderDirection.DSC, OrderDirection.ASC])
  @required()
  active!: boolean;

  constructor(arg?: ModelArg<MethodUser>) {
    super(arg);
  }
}

class MethodQueryBuilderRepo extends Repository<MethodUser, DrizzleAdapter> {
  constructor(adapter: DrizzleAdapter, force = false) {
    super(adapter, MethodUser, force);
  }

  async init() {
    const data = [
      "John Smith",
      "Johnathan Smith",
      "Emily Johnson",
      "Michael Brown",
      "Sarah Davis",
      "David Wilson",
      "Emma Miller",
      "Daniel Taylor",
      "Olivia Anderson",
      "David Smith",
    ].map((name, idx) => {
      return new MethodUser({
        id: (idx + 1).toString(),
        name,
        country: name.slice(-2).toUpperCase(),
        state: name.slice(0, 2).toUpperCase(),
        nif: `10000000${idx}`,
        age: 20 + idx * 2,
        active: idx % 3 === 0,
      });
    });
    return this.createAll(data);
  }

  @query()
  findByName(
    name: string,
    orderBy?: OrderBySelector<any>[],
    limit?: number,
    offset?: number
  ): Promise<MethodUser[]> {
    throw new UnsupportedError(`Method overridden by @query decorator.`);
  }

  @query()
  findByCountryDiff(
    country: string,
    orderBy?: OrderBySelector<any>[],
    limit?: number,
    offset?: number
  ): Promise<MethodUser[]> {
    throw new UnsupportedError(`Method overridden by @query decorator.`);
  }

  @query()
  findByAgeGreaterThanAndAgeLessThan(
    age1: number,
    age2: number,
    orderBy?: OrderBySelector<any>[],
    limit?: number,
    offset?: number
  ): Promise<MethodUser[]> {
    throw new UnsupportedError(`Method overridden by @query decorator.`);
  }

  @query()
  findByAgeGreaterThanEqualAndAgeLessThanEqual(
    age1: number,
    age2: number,
    orderBy?: OrderBySelector<any>[],
    limit?: number,
    offset?: number
  ): Promise<MethodUser[]> {
    throw new UnsupportedError(`Method overridden by @query decorator.`);
  }

  @query()
  findByAgeBetween(
    age1: number,
    age2: number,
    orderBy?: OrderBySelector<any>[],
    limit?: number,
    offset?: number
  ): Promise<MethodUser[]> {
    throw new UnsupportedError(`Method overridden by @query decorator.`);
  }

  @query()
  findByActive(
    active: boolean,
    orderBy?: OrderBySelector<any>[],
    limit?: number,
    offset?: number
  ): Promise<MethodUser[]> {
    throw new UnsupportedError(`Method overridden by @query decorator.`);
  }

  @query()
  findByCountryIn(
    countries: string[],
    orderBy?: OrderBySelector<any>[],
    limit?: number,
    offset?: number
  ): Promise<MethodUser[]> {
    throw new UnsupportedError(`Method overridden by @query decorator.`);
  }

  @query()
  findByNameEqualsOrAgeGreaterThan(
    name: string,
    age: number,
    orderBy?: OrderBySelector<any>[],
    limit?: number,
    offset?: number
  ): Promise<MethodUser[]> {
    throw new UnsupportedError(`Method overridden by @query decorator.`);
  }

  @query()
  findByNameMatches(
    name: string,
    orderBy?: OrderBySelector<any>[],
    limit?: number,
    offset?: number
  ): Promise<MethodUser[]> {
    throw new UnsupportedError(`Method overridden by @query decorator.`);
  }

  @query()
  findByActiveThenSelectNameAndAge(
    active: boolean,
    orderBy?: OrderBySelector<any>[],
    limit?: number,
    offset?: number
  ): Promise<MethodUser[]> {
    throw new UnsupportedError(`Method overridden by @query decorator.`);
  }

  @query({
    allowOffset: false,
    allowLimit: false,
    allowOrderBy: false,
    throws: true,
  })
  findByAgeGreaterThanThenThrows(
    age: number,
    orderBy?: OrderBySelector<any>[],
    limit?: number,
    offset?: number
  ): Promise<MethodUser[]> {
    throw new UnsupportedError(`Method overridden by @query decorator.`);
  }
}

forEachDialect("Drizzle MethodQueryBuilder decorator", async (handle) => {
  await handle.adapter.index(MethodUser);
  const repo = new MethodQueryBuilderRepo(handle.adapter, true);
  await repo.init();

  // Equals
  const john = await repo.findByName("John Smith");
  expect(john.map((r) => r.name)).toEqual(["John Smith"]);

  // Diff
  const notOn = await repo.findByCountryDiff("ON");
  expect(notOn.every((u) => u.country !== "ON")).toBe(true);

  // GreaterThan / LessThan
  const betweenAges = await repo.findByAgeGreaterThanAndAgeLessThan(21, 25);
  expect(betweenAges.every((u) => u.age > 21 && u.age < 25)).toBe(true);

  // GreaterThanEqual / LessThanEqual
  const inclusive = await repo.findByAgeGreaterThanEqualAndAgeLessThanEqual(
    22,
    24
  );
  expect(inclusive.every((u) => u.age >= 22 && u.age <= 24)).toBe(true);

  // Boolean
  const actives = await repo.findByActive(true);
  expect(actives.every((u) => u.active)).toBe(true);
  const inactives = await repo.findByActive(false);
  expect(inactives.every((u) => !u.active)).toBe(true);

  // In
  const countries = await repo.findByCountryIn(["TH", "ON"]);
  expect(countries.map((r) => r.country)).toEqual(
    expect.arrayContaining(["TH", "ON"])
  );

  // Or
  const or = await repo.findByNameEqualsOrAgeGreaterThan("John Smith", 27);
  expect(or.some((u) => u.name === "John Smith")).toBe(true);
  expect(or.some((u) => u.age > 27)).toBe(true);

  // Select
  const selected = await repo.findByActiveThenSelectNameAndAge(true);
  expect(selected.length).toBeGreaterThanOrEqual(2);
  selected.forEach((user) => {
    expect(user.name).toBeDefined();
    expect(user.age).toBeDefined();
    expect((user as any).country).toBeUndefined();
    expect((user as any).state).toBeUndefined();
  });

  const selectedLimited = await repo.findByActiveThenSelectNameAndAge(
    true,
    undefined,
    1
  );
  expect(selectedLimited).toHaveLength(1);

  // Limit
  const limited = await repo.findByActive(true, undefined, 1);
  expect(limited).toHaveLength(1);

  // Offset
  const allActive = await repo.findByActive(true);
  expect(allActive.length).toBeGreaterThanOrEqual(3);
  const offset = await repo.findByActive(true, undefined, 10, 3);
  expect(offset).toHaveLength(1);

  // Disallowed options throw
  await expect(
    repo.findByAgeGreaterThanThenThrows(10, undefined, 1)
  ).rejects.toBeInstanceOf(QueryError);
  await expect(
    repo.findByAgeGreaterThanThenThrows(10, undefined, undefined, 1)
  ).rejects.toBeInstanceOf(QueryError);
});

it(
  "Matches queries are supported on sqlite",
  async () => {
    // Drizzle translates Matches to `col regexp ?`, backed by the adapter's
    // registered sqlite REGEXP implementation.
    const handle = await createSqliteAdapter([MethodUser]);
    try {
      const repo = new MethodQueryBuilderRepo(handle.adapter, true);
      await repo.init();
      const matches = await repo.findByNameMatches("^John");
      expect(matches.every((u) => /^John/.test(u.name))).toBe(true);
    } finally {
      await handle.cleanup();
    }
  }
);

it(
  "Between queries are supported",
  async () => {
    const handle = await createSqliteAdapter([MethodUser]);
    try {
      const repo = new MethodQueryBuilderRepo(handle.adapter, true);
      await repo.init();
      const result = await repo.findByAgeBetween(25, 35);
      expect(result.every((u) => u.age >= 25 && u.age <= 35)).toBe(true);
    } finally {
      await handle.cleanup();
    }
  }
);
