import { BaseModel, column, pk, table } from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { model, Model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { DrizzleFlavour } from "../../src";
import { drizzleRepository, forEachDialect } from "../helpers/drizzleSetup";

Model.setBuilder(Model.fromModel);

jest.setTimeout(180000);

@uses(DrizzleFlavour)
@table("colmap")
@model()
class ColumnMappedModel extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @column("mapped_name")
  @required()
  name!: string;

  @column("mapped_value")
  @required()
  value!: number;

  constructor(arg?: ModelArg<ColumnMappedModel>) {
    super(arg);
  }
}

forEachDialect(
  "REGRESSION: column-mapped fields survive the query path",
  async (handle) => {
    await handle.adapter.index(ColumnMappedModel);
    const repo = drizzleRepository(handle.adapter, ColumnMappedModel);

    await repo.createAll([
      new ColumnMappedModel({ id: 1, name: "alpha", value: 10 }),
      new ColumnMappedModel({ id: 2, name: "beta", value: 20 }),
      new ColumnMappedModel({ id: 3, name: "gamma", value: 30 }),
    ]);

    const results = await repo.select().execute();
    expect(results.length).toBe(3);
    const byId = (id: number) => results.find((r) => r.id === id)!;
    expect(byId(1).name).toBe("alpha");
    expect(byId(1).value).toBe(10);
    expect(byId(3).name).toBe("gamma");
    expect(byId(3).value).toBe(30);
    expect(results.every((r) => r instanceof ColumnMappedModel)).toBe(true);

    const created = await repo.create(
      new ColumnMappedModel({ id: 99, name: "delta", value: 40 })
    );
    expect(created.name).toBe("delta");

    const read = await repo.read(99);
    expect(read.name).toBe("delta");
    expect(read.value).toBe(40);

    read.value = 45;
    await repo.update(read);
    const reread = await repo.read(99);
    expect(reread.name).toBe("delta");
    expect(reread.value).toBe(45);

    await repo.delete(99);
  }
);
