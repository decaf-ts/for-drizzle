import {
  maxlength,
  minlength,
  model,
  ModelArg,
  required,
} from "@decaf-ts/decorator-validation";
import {
  BaseModel,
  column,
  createdBy,
  pk,
  table,
  unique,
  updatedBy,
} from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import { DrizzleFlavour } from "../src/index";

@uses(DrizzleFlavour)
@table("tst_user")
@model()
export class TestModel extends BaseModel {
  @pk({ type: Number, generated: true })
  id!: number;

  @column("tst_name")
  @required()
  name!: string;

  @column("tst_nif")
  @unique()
  @minlength(9)
  @maxlength(9)
  @required()
  nif!: string;

  @column("tst_created_by")
  @createdBy()
  createdBy!: string;

  @column("tst_updated_by")
  @updatedBy()
  updatedBy!: string;

  constructor(arg?: ModelArg<TestModel>) {
    super(arg);
  }
}
