import { BaseModel, OrderDirection, Paginator, pk } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { model, Model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { DrizzleFlavour } from "../../src";
import { drizzleRepository, forEachDialect } from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(180000);

@uses(DrizzleFlavour)
@model()
class PageCountryModel extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @required()
  name!: string;

  @required()
  countryCode!: string;

  constructor(arg?: ModelArg<PageCountryModel>) {
    super(arg);
  }
}

forEachDialect("pagination", async (handle) => {
  await handle.adapter.index(PageCountryModel);
  const repo = drizzleRepository(handle.adapter, PageCountryModel);

  const size = 20;
  const models = Object.keys(new Array(size).fill(0)).map(
    (_, i) =>
      new PageCountryModel({
        id: i + 1,
        name: `country${i + 1}`,
        countryCode: "pt",
      })
  );
  const created = await repo.createAll(models);
  expect(created.length).toBe(size);

  const ordered = await repo
    .select()
    .orderBy(["id", OrderDirection.ASC])
    .execute();
  expect(ordered.map((r) => r.id)).toEqual(
    Object.keys(new Array(size).fill(0)).map((_, i) => i + 1)
  );

  const paginator: Paginator<PageCountryModel> = await repo
    .select()
    .orderBy(["id", OrderDirection.ASC])
    .paginate(5);

  expect(paginator).toBeDefined();
  expect(paginator.size).toBe(5);
  expect(paginator.current).toBeUndefined();

  const page1 = await paginator.page();
  expect(page1.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  expect(paginator.current).toBe(1);

  const page2 = await paginator.next();
  expect(page2.map((r) => r.id)).toEqual([6, 7, 8, 9, 10]);

  const page3 = await paginator.next();
  expect(page3.map((r) => r.id)).toEqual([11, 12, 13, 14, 15]);
});
