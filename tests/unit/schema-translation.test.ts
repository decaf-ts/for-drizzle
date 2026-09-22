import {
  BaseModel,
  Cascade,
  column,
  index,
  manyToOne,
  oneToMany,
  OrderDirection,
  PersistenceKeys,
  pk,
  table,
  unique,
} from "@decaf-ts/core";
import {
  maxlength,
  Model,
  model,
  ModelArg,
  required,
} from "@decaf-ts/decorator-validation";
import {
  clearSchemaCache,
  resolveColumnType,
  translateModel,
} from "../../src";
import { TestModel } from "../TestModel";

Model.setBuilder(Model.fromModel);

@table("schema_user")
@model()
class SchemaUser extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @column("u_name")
  @required()
  @maxlength(32)
  name!: string;

  @column("u_age")
  age!: number;

  @column("u_active")
  active!: boolean;

  @column("u_born")
  born!: Date;

  @column("u_nif")
  @unique()
  @maxlength(9)
  nif!: string;

  @column("u_group")
  @index([OrderDirection.ASC])
  group!: string;

  constructor(arg?: ModelArg<SchemaUser>) {
    super(arg);
  }
}

@table("schema_author")
@model()
class SchemaAuthor extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  name!: string;

  constructor(arg?: ModelArg<SchemaAuthor>) {
    super(arg);
  }
}

@table("schema_book")
@model()
class SchemaBook extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @column("b_title")
  @required()
  title!: string;

  @manyToOne(SchemaAuthor, {
    update: Cascade.CASCADE,
    delete: Cascade.CASCADE,
  })
  author!: SchemaAuthor;

  constructor(arg?: ModelArg<SchemaBook>) {
    super(arg);
  }
}

@table("schema_shelf")
@model()
class SchemaShelf extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @oneToMany(SchemaBook, {
    update: Cascade.CASCADE,
    delete: Cascade.CASCADE,
  })
  books!: SchemaBook[];

  constructor(arg?: ModelArg<SchemaShelf>) {
    super(arg);
  }
}

describe("resolveColumnType", () => {
  it.each([
    [String, "string"],
    [Number, "number"],
    [Boolean, "boolean"],
    [Date, "date"],
    [BigInt, "bigint"],
    [Object, "object"],
  ])("maps %p to %s", (input, expected) => {
    expect(resolveColumnType(input)).toBe(expected);
  });

  it("maps constructor functions and unknown values", () => {
    expect(resolveColumnType("string")).toBe("string");
    expect(resolveColumnType(undefined)).toBe("object");
    expect(resolveColumnType({})).toBe("object");
  });
});

describe("translateModel", () => {
  beforeEach(() => clearSchemaCache());

  it("translates table, pk and column names for sqlite", () => {
    const schema = translateModel(SchemaUser, "sqlite");
    expect(schema.dialect).toBe("sqlite");
    expect(schema.tableName).toBe("schema_user");
    expect(schema.pk).toBe("id");
    expect(schema.pkDbName).toBe("id");
    expect(schema.generatedPk).toBe(true);
    expect(schema.columnNames.name).toBe("u_name");
    expect(schema.propertyNames.u_name).toBe("name");
  });

  it("resolves property types for every declared column", () => {
    const schema = translateModel(SchemaUser, "sqlite");
    expect(schema.columns.name.type).toBe("string");
    expect(schema.columns.age.type).toBe("number");
    expect(schema.columns.active.type).toBe("boolean");
    expect(schema.columns.born.type).toBe("date");
    expect(schema.columns.id.primaryKey).toBe(true);
  });

  it(
    "reads @required/@unique/@maxlength validation metadata",
    () => {
      // `isRequired`/`isUnique`/`maxLength` in src/schema/translation.ts
      // read validation metadata via Metadata.validationFor.
      const schema = translateModel(SchemaUser, "sqlite");
      expect(schema.columns.name.required).toBe(true);
      expect(schema.columns.name.maxLength).toBe(32);
      expect(schema.columns.nif.unique).toBe(true);
    }
  );

  it("exposes declared indexes keyed by model property name", () => {
    const schema = translateModel(SchemaUser, "sqlite");
    expect(schema.indexDefinitions.length).toBeGreaterThan(0);
    const groupIndex = schema.indexDefinitions.find((def) =>
      def.columns.includes("group")
    );
    expect(groupIndex).toBeDefined();
    expect(groupIndex!.columns).toContain("group");
  });

  it(
    "indexDefinitions expose physical column names",
    () => {
      const schema = translateModel(SchemaUser, "sqlite");
      const groupIndex = schema.indexDefinitions.find((def) =>
        def.columns.includes("group")
      );
      expect(groupIndex).toBeDefined();
      expect(groupIndex!.columns).toContain("u_group");
    }
  );

  it("prefixes framework-owned tables with the drizzle flavour", () => {
    const schema = translateModel(TestModel, "sqlite");
    expect(schema.tableName).toBe("tst_user");
    expect(schema.columnNames.nif).toBe("tst_nif");
  });

  it("caches schemas per model and dialect so table identity is stable", () => {
    const first = translateModel(SchemaUser, "sqlite");
    const second = translateModel(SchemaUser, "sqlite");
    expect(second).toBe(first);
    const mysql = translateModel(SchemaUser, "mysql");
    expect(mysql).not.toBe(first);
    expect(mysql.dialect).toBe("mysql");
    clearSchemaCache();
    expect(translateModel(SchemaUser, "sqlite")).not.toBe(first);
  });
});

describe("translateModel (postgres)", () => {
  beforeEach(() => clearSchemaCache());

  it("translates table, pk and column names for postgres", () => {
    const schema = translateModel(SchemaUser, "postgres");
    expect(schema.dialect).toBe("postgres");
    expect(schema.tableName).toBe("schema_user");
    expect(schema.pk).toBe("id");
    expect(schema.pkDbName).toBe("id");
    expect(schema.generatedPk).toBe(true);
    expect(schema.columnNames.name).toBe("u_name");
    expect(schema.propertyNames.u_name).toBe("name");
  });

  it("resolves property types for every declared column for postgres", () => {
    const schema = translateModel(SchemaUser, "postgres");
    expect(schema.columns.name.type).toBe("string");
    expect(schema.columns.age.type).toBe("number");
    expect(schema.columns.active.type).toBe("boolean");
    expect(schema.columns.born.type).toBe("date");
    expect(schema.columns.id.primaryKey).toBe(true);
  });

  it("reads @required/@unique/@maxlength validation metadata for postgres", () => {
    const schema = translateModel(SchemaUser, "postgres");
    expect(schema.columns.name.required).toBe(true);
    expect(schema.columns.name.maxLength).toBe(32);
    expect(schema.columns.nif.unique).toBe(true);
  });

  it("exposes declared indexes with physical column names for postgres", () => {
    const schema = translateModel(SchemaUser, "postgres");
    expect(schema.indexDefinitions.length).toBeGreaterThan(0);
    const groupIndex = schema.indexDefinitions.find((def) =>
      def.columns.includes("group")
    );
    expect(groupIndex).toBeDefined();
    expect(groupIndex!.columns).toContain("u_group");
  });
});

describe("relation translation", () => {
  beforeEach(() => clearSchemaCache());

  describe("@manyToOne", () => {
    it.each(["sqlite", "mysql", "postgres"] as const)(
      "generates a foreign-key column targeting the target primary key (%s)",
      (dialect) => {
        const target = translateModel(SchemaAuthor, dialect);
        const source = translateModel(SchemaBook, dialect);
        expect(source.columns.author).toBeDefined();
        expect(source.columns.author.relation).toBeDefined();
        expect(source.columns.author.relation!.key).toBe(
          PersistenceKeys.MANY_TO_ONE
        );
        // `relation.target` is a decorated-constructor proxy, so compare the
        // resolved table identity rather than the raw reference.
        expect(source.columns.author.relation!.target.name).toBe(
          "SchemaAuthor"
        );
        expect(
          Model.tableName(source.columns.author.relation!.target as any)
        ).toBe("schema_author");
        // the foreign-key column targets the target table's primary key
        expect(target.pk).toBe("id");
        expect(target.columns.id.primaryKey).toBe(true);
      }
    );
  });

  describe("@oneToMany", () => {
    it.each(["sqlite", "mysql", "postgres"] as const)(
      "leaves the foreign key on the owning @manyToOne side (%s)",
      (dialect) => {
        const shelf = translateModel(SchemaShelf, dialect);
        const book = translateModel(SchemaBook, dialect);
        // the inverse side is not a foreign-key owner and emits no column...
        expect(shelf.columns.books).toBeUndefined();
        // ...the owning @manyToOne side is
        expect(book.columns.author.relation!.key).toBe(
          PersistenceKeys.MANY_TO_ONE
        );
        expect(book.columns.author.relation!.target.name).toBe(
          "SchemaAuthor"
        );
        expect(
          Model.tableName(book.columns.author.relation!.target as any)
        ).toBe("schema_author");
      }
    );

    it(
      "emits no extra column for the @oneToMany inverse property",
      () => {
        const shelf = translateModel(SchemaShelf, "sqlite");
        expect(shelf.columns.books).toBeUndefined();
      }
    );
  });
});

