import { Model } from "@decaf-ts/decorator-validation";
import {
  TestAddressModel,
  TestCountryModel,
  TestPhoneModel,
  TestUserModel,
} from "../helpers/models";
import {
  createMysqlAdapter,
  createPostgresAdapter,
  createSqliteAdapter,
  drizzleRepository,
  hasMysql,
  hasPostgres,
  MYSQL_TEST_TIMEOUT_MS,
  POSTGRES_TEST_TIMEOUT_MS,
} from "../helpers/drizzleSetup";
import type { DrizzleTestHandle } from "../helpers/drizzleSetup";
import { BaseModel, Cascade, manyToOne, oneToMany, pk, table } from "@decaf-ts/core";
import { model, ModelArg, required } from "@decaf-ts/decorator-validation";

Model.setBuilder(Model.fromModel);

jest.setTimeout(180000);

@table("rel_author")
@model()
class RelAuthorModel extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  name!: string;

  constructor(arg?: ModelArg<RelAuthorModel>) {
    super(arg);
  }
}

@table("rel_book")
@model()
class RelBookModel extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  title!: string;

  @manyToOne(RelAuthorModel, {
    update: Cascade.CASCADE,
    delete: Cascade.CASCADE,
  })
  author!: RelAuthorModel;

  constructor(arg?: ModelArg<RelBookModel>) {
    super(arg);
  }
}

@table("rel_shelf")
@model()
class RelShelfModel extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @oneToMany(RelBookModel, {
    update: Cascade.CASCADE,
    delete: Cascade.CASCADE,
  })
  books!: RelBookModel[];

  constructor(arg?: ModelArg<RelShelfModel>) {
    super(arg);
  }
}

function foreignKeyQuery(dialect: DrizzleTestHandle["dialect"]): string {
  if (dialect === "mysql")
    return (
      "SELECT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rel_book' " +
      "AND REFERENCED_TABLE_NAME = 'rel_author'"
    );
  if (dialect === "postgres")
    return (
      "SELECT constraint_name AS name FROM information_schema.table_constraints " +
      "WHERE table_schema = current_schema() AND table_name = 'rel_book' " +
      "AND constraint_type = 'FOREIGN KEY'"
    );
  return "PRAGMA foreign_key_list('rel_book')";
}

function tableColumnsQuery(
  dialect: DrizzleTestHandle["dialect"],
  table: string
): string {
  if (dialect === "mysql")
    return (
      "SELECT COLUMN_NAME AS name FROM information_schema.columns " +
      `WHERE table_schema = DATABASE() AND table_name = '${table}'`
    );
  if (dialect === "postgres")
    return (
      "SELECT column_name AS name FROM information_schema.columns " +
      `WHERE table_schema = current_schema() AND table_name = '${table}'`
    );
  return `PRAGMA table_info('${table}')`;
}

function relationsSuite(
  label: string,
  create: () => Promise<DrizzleTestHandle | undefined>,
  timeout: number = MYSQL_TEST_TIMEOUT_MS
) {
  describe(label, () => {
    let handle: DrizzleTestHandle;

    beforeAll(async () => {
      handle = (await create()) as DrizzleTestHandle;
      await handle.adapter.index(
        TestCountryModel,
        TestPhoneModel,
        TestAddressModel,
        TestUserModel,
        RelAuthorModel,
        RelBookModel,
        RelShelfModel
      );
    }, timeout);

    afterAll(async () => {
      if (handle) await handle.cleanup();
    });

    it("cascade-creates and reads a one-to-one relation", async () => {
      const addresses = drizzleRepository(handle.adapter, TestAddressModel);
      const countries = drizzleRepository(handle.adapter, TestCountryModel);

      const address = await addresses.create(
        new TestAddressModel({
          street: "Main",
          doorNumber: "1",
          areaCode: "1000",
          city: "Lisbon",
          country: {
            name: "Portugal",
            countryCode: "pt",
            locale: "pt_PT",
          } as any,
        })
      );
      expect(address.country).toBeDefined();

      const read = await addresses.read(address.id);
      expect(read.city).toBe("Lisbon");
      expect(read.country).toBeDefined();
      const country = await countries.read(read.country.id);
      expect(country.name).toBe("Portugal");
    });

    it(
      "cascade-creates and reads a one-to-many relation",
      async () => {
        // The child phones are cascade-created through createAll and the
        // generated-pk sequence now yields numeric ids that pass validation.
        const users = drizzleRepository(handle.adapter, TestUserModel);
        const phones = drizzleRepository(handle.adapter, TestPhoneModel);

        const user = new TestUserModel({
        name: "Alice",
        email: "alice@example.com",
        age: 30,
        address: {
          street: "Gran Via",
          doorNumber: "2",
          areaCode: "28013",
          city: "Madrid",
          country: {
            name: "Spain",
            countryCode: "es",
            locale: "es_ES",
          },
        } as any,
        phones: [
          { areaCode: "34", number: "600000001" },
          { areaCode: "34", number: "600000002" },
        ] as any,
      });

      const created = await users.create(user);
      expect(created.id).toBeDefined();
      expect(created.address).toBeDefined();
      expect(created.phones.length).toBe(2);

      const read = await users.read(created.id);
      expect(read.name).toBe("Alice");
      expect(read.address).toBeDefined();
      // A unidirectional @oneToMany inverse emits no column, so it is not
      // persisted on the parent; the cascade-created children still live in
      // their own table and remain readable by primary key.
      expect(read.phones).toBeUndefined();
      expect(created.phones.length).toBe(2);

      const readPhone = await phones.read(created.phones[0].id);
      expect(readPhone.number).toBe("600000001");
      },
      timeout
    );

    it(
      "materialises a @manyToOne foreign-key column targeting the target primary key",
      async () => {
        const authors = drizzleRepository(handle.adapter, RelAuthorModel);
        const books = drizzleRepository(handle.adapter, RelBookModel);

        const author = await authors.create(
          new RelAuthorModel({ id: 1, name: "Ursula" })
        );
        const book = await books.create(
          new RelBookModel({
            id: 1,
            title: "A Wizard of Earthsea",
            author,
          } as any)
        );
        expect(book.id).toBeDefined();

        // The relation is populated from the generated foreign-key column, which
        // holds the target's primary key.
        const read = await books.read(book.id);
        expect(read.author).toBeDefined();
        expect((read.author as RelAuthorModel).id).toBe(author.id);

        // Join the generated foreign-key column live to the target primary key
        // and read the target row back.
        const schema = handle.adapter.schema(RelBookModel);
        const fkColumn = schema.columns.author.dbName;
        const rows = (await handle.adapter.raw(
          `SELECT b.${fkColumn} AS fk, a.${handle.adapter.pkColumnName(RelAuthorModel)} AS id, a.name AS name ` +
            `FROM ${schema.tableName} b ` +
            `JOIN ${handle.adapter.schema(RelAuthorModel).tableName} a ` +
            `ON b.${fkColumn} = a.${handle.adapter.pkColumnName(RelAuthorModel)}`,
          true
        )) as any[];
        expect(rows).toHaveLength(1);
        expect(Number(rows[0].fk)).toBe(author.id);
        expect(rows[0].name).toBe("Ursula");
      },
      timeout
    );

    it(
      "emits a database-level FOREIGN KEY constraint in adapter.index() DDL",
      async () => {
        // README: "@manyToOne ... FK column + foreignKey extra ... honoured by
        // adapter.index() DDL". The DDL generator renders a CONSTRAINT ...
        // FOREIGN KEY clause for every translated foreign key.
        const foreignKeys = (await handle.adapter.raw(
          foreignKeyQuery(handle.dialect),
          true
        )) as any[];
        expect(foreignKeys.length).toBeGreaterThan(0);
      },
      timeout
    );

    it(
      "leaves the @oneToMany foreign key on the owning @manyToOne side",
      async () => {
        const schema = handle.adapter.schema(RelShelfModel);
        // The inverse side owns no column and no foreign-key relation...
        expect(schema.columns.books).toBeUndefined();
        // ...the owning side does, so the FK column lives on the child table.
        const bookSchema = handle.adapter.schema(RelBookModel);
        expect(bookSchema.columns.author.relation?.key).toBe(
          "relation.many-to-one"
        );

        const rawColumns = (await handle.adapter.raw(
          tableColumnsQuery(handle.dialect, "rel_shelf"),
          true
        )) as any[];
        const columnNames = rawColumns.map(
          (row) => row.name ?? row.COLUMN_NAME
        );
        expect(columnNames).not.toContain(bookSchema.columns.author.dbName);
      },
      timeout
    );
  });
}


relationsSuite("relations (sqlite)", () => createSqliteAdapter());
if (hasMysql()) {
  relationsSuite("relations (mysql)", () => createMysqlAdapter());
} else {
  console.warn(
    "[drizzle-tests] MYSQL_URI not set: mysql relation coverage not exercised"
  );
}

if (hasPostgres()) {
  relationsSuite(
    "relations (postgres)",
    () => createPostgresAdapter(),
    POSTGRES_TEST_TIMEOUT_MS
  );
} else {
  console.warn(
    "[drizzle-tests] POSTGRES_URI not set: postgres relation coverage not exercised"
  );
}
