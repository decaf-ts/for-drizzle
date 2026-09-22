import {
  BaseModel,
  Condition,
  index,
  OrderDirection,
  pk,
} from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { model, Model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { DrizzleFlavour } from "../../src";
import { drizzleRepository, forEachDialect } from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(180000);

@uses(DrizzleFlavour)
@model()
class LeaderboardEntry extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  @index([OrderDirection.ASC, OrderDirection.DSC], ["score"])
  category!: string;

  @required()
  score!: number;

  constructor(arg?: ModelArg<LeaderboardEntry>) {
    super(arg);
  }
}

forEachDialect("multi-level sorting", async (handle) => {
  await handle.adapter.index(LeaderboardEntry);
  const repo = drizzleRepository(handle.adapter, LeaderboardEntry);

  await repo.createAll(
    [
      { id: 1, category: "alpha", score: 10 },
      { id: 2, category: "alpha", score: 7 },
      { id: 3, category: "beta", score: 12 },
      { id: 4, category: "beta", score: 9 },
      { id: 5, category: "beta", score: 5 },
      { id: 6, category: "gamma", score: 14 },
      { id: 7, category: "gamma", score: 11 },
      { id: 8, category: "gamma", score: 8 },
    ].map((entry) => new LeaderboardEntry(entry))
  );

  const condition = Condition.attribute<LeaderboardEntry>("category")
    .gte("")
    .and(Condition.attribute<LeaderboardEntry>("score").gte(0));

  const results = await repo
    .select()
    .where(condition)
    .orderBy("category", OrderDirection.ASC)
    .thenBy("score", OrderDirection.ASC)
    .execute();

  expect(results.map((r) => r.category)).toEqual([
    "alpha",
    "alpha",
    "beta",
    "beta",
    "beta",
    "gamma",
    "gamma",
    "gamma",
  ]);
  expect(
    results
      .filter((r) => r.category === "alpha")
      .map((r) => r.score)
  ).toEqual([7, 10]);
  expect(
    results
      .filter((r) => r.category === "beta")
      .map((r) => r.score)
  ).toEqual([5, 9, 12]);

  const stringDirections = await repo
    .select()
    .where(condition)
    .orderBy("category", OrderDirection.ASC)
    .thenBy("score", "asc" as any)
    .execute();
  expect(
    stringDirections
      .filter((r) => r.category === "gamma")
      .map((r) => r.score)
  ).toEqual([8, 11, 14]);
});
