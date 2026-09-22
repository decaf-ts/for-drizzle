import {
  BaseModel,
  column,
  Condition,
  pk,
  table,
} from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { Model, model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { SQLiteDialect } from "drizzle-orm/sqlite-core";
import { DrizzleFlavour } from "../../src";
import { DrizzleStatement } from "../../src/query/Statement";

// Decaf models must be constructible from plain objects in tests.
Model.setBuilder(Model.fromModel);

@uses(DrizzleFlavour)
@table("exists_condition_items")
@model()
class ExistsConditionItem extends BaseModel {
  @pk({ type: Number, generated: false })
  id!: number;

  @column("processed")
  @required()
  processed!: boolean;

  @column("entity_id")
  @required()
  entityId!: number;

  @column("nickname")
  nickname?: string;

  constructor(arg?: ModelArg<ExistsConditionItem>) {
    super(arg);
  }
}

// `parseCondition` only needs the model schema and the dialect; a stub adapter
// config avoids opening a real database connection in the unit suite.
function newStatement(): any {
  const statement = new DrizzleStatement<ExistsConditionItem, any>({
    config: { dialect: "sqlite" },
  } as any);
  statement.from(ExistsConditionItem);
  return statement;
}

const dialect = new SQLiteDialect();

function serialise(condition: Condition<ExistsConditionItem>): {
  sql: string;
  params: unknown[];
} {
  const built = newStatement().parseCondition(condition);
  return dialect.sqlToQuery(built);
}

describe("DrizzleStatement EXISTS translation", () => {
  it("translates a field-level EXISTS condition into IS NOT NULL", () => {
    const serialised = serialise(
      Condition.attribute<ExistsConditionItem>("processed").exists()
    );

    expect(serialised.sql).toBe(
      '"exists_condition_items"."processed" is not null'
    );
    expect(serialised.params).toEqual([]);
  });

  it("does not throw UnsupportedError for Operator.EXISTS", () => {
    const condition =
      Condition.attribute<ExistsConditionItem>("processed").exists();

    expect(() => serialise(condition)).not.toThrow();
    expect(serialise(condition).sql).toContain("is not null");
  });

  it("binds no comparison value for an EXISTS leg", () => {
    const serialised = serialise(
      Condition.attribute<ExistsConditionItem>("nickname").exists()
    );

    expect(serialised.sql).toBe(
      '"exists_condition_items"."nickname" is not null'
    );
    expect(serialised.params).toEqual([]);
  });

  it("combines an EXISTS leg with a normal equality leg under AND", () => {
    const serialised = serialise(
      Condition.attribute<ExistsConditionItem>("processed")
        .exists()
        .and(Condition.attribute<ExistsConditionItem>("entityId").eq(5))
    );

    expect(serialised.sql).toBe(
      '("exists_condition_items"."processed" is not null and "exists_condition_items"."entity_id" = ?)'
    );
    expect(serialised.params).toEqual([5]);
  });

  it("combines an EXISTS leg with a normal equality leg under OR", () => {
    const serialised = serialise(
      Condition.attribute<ExistsConditionItem>("nickname")
        .exists()
        .or(Condition.attribute<ExistsConditionItem>("entityId").eq(7))
    );

    expect(serialised.sql).toBe(
      '("exists_condition_items"."nickname" is not null or "exists_condition_items"."entity_id" = ?)'
    );
    expect(serialised.params).toEqual([7]);
  });
});
