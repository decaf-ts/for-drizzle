import {
  BaseModel,
  Condition,
  Context,
  defaultQueryAttr,
  index,
  OrderDirection,
  pk,
  table,
} from "@decaf-ts/core";
import { uses } from "@decaf-ts/decoration";
import {
  min,
  minlength,
  Model,
  model,
  ModelArg,
  required,
  type,
} from "@decaf-ts/decorator-validation";
import { readonly } from "@decaf-ts/db-decorators";
import { DrizzleFlavour } from "../../src";
import {
  createMysqlAdapter,
  createSqliteAdapter,
  drizzleRepository,
  hasMysql,
  MYSQL_TEST_TIMEOUT_MS,
} from "../helpers/drizzleSetup";
import type { DrizzleTestHandle } from "../helpers/drizzleSetup";

// Decaf models must be constructible from plain objects in tests.
Model.setBuilder(Model.fromModel);

jest.setTimeout(300000);

@uses(DrizzleFlavour)
@model()
class QueryUser extends BaseModel {
  @pk({ type: Number })
  id!: number;

  @required()
  @min(18)
  @index([OrderDirection.DSC, OrderDirection.ASC])
  age!: number;

  @required()
  @minlength(5)
  name!: string;

  @required()
  @readonly()
  @type([String])
  sex!: "M" | "F";

  constructor(arg?: ModelArg<QueryUser>) {
    super(arg);
  }
}

@uses(DrizzleFlavour)
@model()
class DefaultStringQueryModel extends BaseModel {
  @pk({ type: Number })
  id?: number = undefined;

  @required()
  @defaultQueryAttr()
  attr1?: string = undefined;

  @required()
  @defaultQueryAttr()
  attr2?: string = undefined;

  constructor(arg?: ModelArg<DefaultStringQueryModel>) {
    super(arg);
  }
}

@uses(DrizzleFlavour)
@table("product_gtin_boundary")
@model()
class GtinProductModel extends BaseModel {
  @pk({ type: String })
  @defaultQueryAttr()
  productCode!: string;

  @required()
  inventedName!: string;

  @required()
  nameMedicinalProduct!: string;

  constructor(arg?: ModelArg<GtinProductModel>) {
    super(arg);
  }
}

@uses(DrizzleFlavour)
@model()
class NumericSearchModel extends BaseModel {
  @pk({ type: Number })
  id?: number = undefined;

  @required()
  @defaultQueryAttr()
  searchName?: string = undefined;

  @required()
  @defaultQueryAttr()
  searchCode?: string = undefined;

  constructor(arg?: ModelArg<NumericSearchModel>) {
    super(arg);
  }
}

/**
 * Flattens a Drizzle `SQL` object into its SQL text and bound parameters so the
 * generated statement can be asserted without reaching into the driver.
 */
function flattenSql(
  query: any,
  out: { text: string; params: any[] } = { text: "", params: [] }
): { text: string; params: any[] } {
  const chunks: any[] = query?.queryChunks ?? [];
  for (const chunk of chunks) {
    if (typeof chunk === "string") {
      out.text += chunk;
      continue;
    }
    if (!chunk || typeof chunk !== "object") continue;
    if (chunk.queryChunks) {
      flattenSql(chunk, out);
      continue;
    }
    if (Array.isArray(chunk.value)) {
      out.text += chunk.value.join("");
      continue;
    }
    if ("encoder" in chunk || chunk.constructor?.name === "Param") {
      out.params.push(chunk.value);
      continue;
    }
    if (typeof chunk.name === "string") {
      out.text += chunk.name;
      continue;
    }
  }
  return out;
}

/**
 * Runs the ported for-nano query suite against one dialect. Mirrors
 * `regression.column-mapped-query.test.ts`: the handle is created once per
 * dialect and the cases run as individual `it`s so a `src/**` defect can be
 * encoded as `it.failing` without hiding the rest.
 */
function dialectSuite(
  label: string,
  dialect: "sqlite" | "mysql",
  create: () => Promise<DrizzleTestHandle | undefined>
): void {
  describe(label, () => {
    let handle: DrizzleTestHandle;
    let created: QueryUser[];
    let stringRepo: ReturnType<typeof drizzleRepository<DefaultStringQueryModel>>;
    let numericRepo: ReturnType<typeof drizzleRepository<NumericSearchModel>>;
    let productRepo: ReturnType<typeof drizzleRepository<GtinProductModel>>;
    const bookmarkCtx = new Context().accumulate({ paginateByBookmark: true });

    beforeAll(async () => {
      handle = (await create()) as DrizzleTestHandle;
      await handle.adapter.index(
        QueryUser,
        DefaultStringQueryModel,
        GtinProductModel,
        NumericSearchModel
      );

      const userRepo = drizzleRepository(handle.adapter, QueryUser);
      created = await userRepo.createAll(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(
          (i) =>
            new QueryUser({
              age: Math.floor(18 + (i - 1) / 3),
              name: "user_name_" + i,
              sex: i % 2 === 0 ? "M" : "F",
            })
        )
      );

      stringRepo = drizzleRepository(handle.adapter, DefaultStringQueryModel);
      await stringRepo.createAll([
        new DefaultStringQueryModel({ attr1: "apple", attr2: "zebra" }),
        new DefaultStringQueryModel({ attr1: "apricot", attr2: "amber" }),
        new DefaultStringQueryModel({ attr1: "banana", attr2: "aurora" }),
        new DefaultStringQueryModel({ attr1: "delta", attr2: "aardvark" }),
        new DefaultStringQueryModel({ attr1: "omega", attr2: "alpha" }),
        new DefaultStringQueryModel({ attr1: "sigma", attr2: "altitude" }),
      ]);

      numericRepo = drizzleRepository(handle.adapter, NumericSearchModel);
      await numericRepo.createAll([
        new NumericSearchModel({ searchName: "10Start", searchCode: "10-Start" }),
        new NumericSearchModel({ searchName: "1Alpha", searchCode: "1-Alpha" }),
        new NumericSearchModel({ searchName: "1Beta", searchCode: "1-Beta" }),
        new NumericSearchModel({ searchName: "1Zeta", searchCode: "1-Zeta" }),
        new NumericSearchModel({ searchName: "a1-Gamma", searchCode: "1-Gamma" }),
        new NumericSearchModel({ searchName: "foo10", searchCode: "10-Foo" }),
        new NumericSearchModel({ searchName: "alpha10", searchCode: "alpha-10" }),
        new NumericSearchModel({ searchName: "2Delta", searchCode: "2-Delta" }),
      ]);

      productRepo = drizzleRepository(handle.adapter, GtinProductModel);
      await productRepo.create(
        new GtinProductModel({
          productCode: "98765432109879",
          inventedName: "gtin-boundary-product",
          nameMedicinalProduct: "gtin-boundary-medicine",
        })
      );
    }, MYSQL_TEST_TIMEOUT_MS);

    afterAll(async () => {
      if (handle) await handle.cleanup();
    });

    describe("Queries", () => {
      it("Creates in bulk", () => {
        expect(created).toBeDefined();
        expect(Array.isArray(created)).toEqual(true);
        expect(created.every((el) => el instanceof QueryUser)).toEqual(true);
        expect(created.every((el) => !el.hasErrors())).toEqual(true);
      });

      it("Performs simple queries - full object", async () => {
        const repo = drizzleRepository(handle.adapter, QueryUser);
        const selected = await repo.select().execute();
        expect(selected.length).toEqual(created.length);
        expect(selected.map((s) => s.id).sort((a, b) => a - b)).toEqual(
          created.map((c) => c.id).sort((a, b) => a - b)
        );
        expect(selected.every((s) => s instanceof QueryUser)).toEqual(true);
      });

      it("Performs simple queries - attributes only", async () => {
        const repo = drizzleRepository(handle.adapter, QueryUser);
        const selected = await repo.select(["age", "sex"]).execute();
        expect(selected).toEqual(
          expect.arrayContaining(
            [...new Array(created.length)].map(() =>
              expect.objectContaining({
                age: expect.any(Number),
                sex: expect.stringMatching(/^M|F$/g),
              })
            )
          )
        );
      });

      it("Performs conditional queries - full object", async () => {
        const repo = drizzleRepository(handle.adapter, QueryUser);
        const condition = Condition.attribute<QueryUser>("age").eq(20);
        const selected = await repo.select().where(condition).execute();
        expect(selected.length).toEqual(
          created.filter((c) => c.age === 20).length
        );
      });

      it("Performs conditional queries - selected attributes", async () => {
        const repo = drizzleRepository(handle.adapter, QueryUser);
        const condition = Condition.attribute<QueryUser>("age").eq(20);
        const selected = await repo
          .select(["age", "sex"])
          .where(condition)
          .execute();
        expect(selected.length).toEqual(
          created.filter((c) => c.age === 20).length
        );
        expect(selected).toEqual(
          expect.arrayContaining(
            [...new Array(created.length)].map(() =>
              expect.objectContaining({
                age: expect.any(Number),
                sex: expect.stringMatching(/^M|F$/g),
              })
            )
          )
        );
      });

      it("Performs AND conditional queries - full object", async () => {
        const repo = drizzleRepository(handle.adapter, QueryUser);
        const condition = Condition.attribute<QueryUser>("age")
          .eq(20)
          .and(Condition.attribute<QueryUser>("sex").eq("M"));
        const selected = await repo.select().where(condition).execute();
        expect(selected.length).toEqual(
          created.filter((c) => c.age === 20 && c.sex === "M").length
        );
      });

      it("Performs OR conditional queries - full object", async () => {
        const repo = drizzleRepository(handle.adapter, QueryUser);
        const condition = Condition.attribute<QueryUser>("age")
          .eq(20)
          .or(Condition.attribute<QueryUser>("age").eq(19));
        const selected = await repo.select().where(condition).execute();
        expect(selected.length).toEqual(
          created.filter((c) => c.age === 20 || c.age === 19).length
        );
      });

      it("Performs BIGGER / SMALLER conditional queries", async () => {
        const repo = drizzleRepository(handle.adapter, QueryUser);
        const bigger = await repo
          .select()
          .where(Condition.attribute<QueryUser>("age").gt(20))
          .execute();
        expect(bigger.map((r) => r.id).sort((a, b) => a - b)).toEqual(
          created.filter((c) => c.age > 20).map((c) => c.id)
        );

        const smaller = await repo
          .select()
          .where(Condition.attribute<QueryUser>("age").lt(19))
          .execute();
        expect(smaller.map((r) => r.id).sort((a, b) => a - b)).toEqual(
          created.filter((c) => c.age < 19).map((c) => c.id)
        );
      });

      it("Performs BIGGER_EQ / SMALLER_EQ conditional queries", async () => {
        const repo = drizzleRepository(handle.adapter, QueryUser);
        const biggerEq = await repo
          .select()
          .where(Condition.attribute<QueryUser>("age").gte(20))
          .execute();
        expect(biggerEq.map((r) => r.id).sort((a, b) => a - b)).toEqual(
          created.filter((c) => c.age >= 20).map((c) => c.id)
        );

        const smallerEq = await repo
          .select()
          .where(Condition.attribute<QueryUser>("age").lte(18))
          .execute();
        expect(smallerEq.map((r) => r.id).sort((a, b) => a - b)).toEqual(
          created.filter((c) => c.age <= 18).map((c) => c.id)
        );
      });

      it("Performs DIFFERENT conditional queries", async () => {
        const repo = drizzleRepository(handle.adapter, QueryUser);
        const selected = await repo
          .select()
          .where(Condition.attribute<QueryUser>("age").dif(20))
          .execute();
        expect(selected.length).toEqual(
          created.filter((c) => c.age !== 20).length
        );
      });

      it("Performs IN conditional queries", async () => {
        const repo = drizzleRepository(handle.adapter, QueryUser);
        const selected = await repo
          .select()
          .where(Condition.attribute<QueryUser>("age").in([18, 21]))
          .execute();
        expect(selected.length).toEqual(
          created.filter((c) => c.age === 18 || c.age === 21).length
        );
      });

      it("Performs STARTS_WITH conditional queries", async () => {
        const repo = drizzleRepository(handle.adapter, QueryUser);
        const selected = await repo
          .select()
          .where(Condition.attribute<QueryUser>("name").startsWith("user_name_1"))
          .execute();
        expect(selected.length).toEqual(
          created.filter((c) => c.name.startsWith("user_name_1")).length
        );
      });

      it("Performs ENDS_WITH conditional queries", async () => {
        const repo = drizzleRepository(handle.adapter, QueryUser);
        const selected = await repo
          .select()
          .where(Condition.attribute<QueryUser>("name").endsWith("_10"))
          .execute();
        expect(selected.map((r) => r.id)).toEqual(
          created.filter((c) => c.name.endsWith("_10")).map((c) => c.id)
        );
      });

      if (dialect === "sqlite") {
        it(
          "Performs REGEXP conditional queries",
          async () => {
            // DrizzleStatement.parseCondition translates REGEXP to a sqlite
            // `regexp` call backed by the adapter's registered implementation.
            const repo = drizzleRepository(handle.adapter, QueryUser);
            const selected = await repo
              .select()
              .where(
                Condition.attribute<QueryUser>("name").regexp("^user_name_1")
              )
              .execute();
            expect(selected.map((r) => r.id).sort((a, b) => a - b)).toEqual(
              created
                .filter((c) => /^user_name_1/.test(c.name))
                .map((c) => c.id)
            );
          }
        );
      } else {
        it("Performs REGEXP conditional queries", async () => {
          const repo = drizzleRepository(handle.adapter, QueryUser);
          const selected = await repo
            .select()
            .where(Condition.attribute<QueryUser>("name").regexp("^user_name_1"))
            .execute();
          expect(selected.map((r) => r.id).sort((a, b) => a - b)).toEqual(
            created
              .filter((c) => /^user_name_1/.test(c.name))
              .map((c) => c.id)
          );
        });
      }

      it("Performs NOT conditional queries", async () => {
        const repo = drizzleRepository(handle.adapter, QueryUser);
        const selected = await repo
          .select()
          .where(Condition.attribute<QueryUser>("age").eq(20).not())
          .execute();
        expect(selected.length).toEqual(
          created.filter((c) => c.age !== 20).length
        );
      });

      it("Sorts an indexed attribute in both directions", async () => {
        const repo = drizzleRepository(handle.adapter, QueryUser);
        const asc = await repo
          .select()
          .orderBy(["age", OrderDirection.ASC])
          .execute();
        const ascAges = asc.map((r) => r.age);
        expect(ascAges).toEqual([...ascAges].sort((a, b) => a - b));
        expect(ascAges[0]).toEqual(Math.min(...created.map((c) => c.age)));
        expect(ascAges[ascAges.length - 1]).toEqual(
          Math.max(...created.map((c) => c.age))
        );

        const desc = await repo
          .select()
          .orderBy(["age", OrderDirection.DSC])
          .execute();
        const descAges = desc.map((r) => r.age);
        expect(descAges).toEqual([...descAges].sort((a, b) => b - a));
        expect(descAges[0]).toEqual(Math.max(...created.map((c) => c.age)));
        expect(descAges[descAges.length - 1]).toEqual(
          Math.min(...created.map((c) => c.age))
        );
      });

      it("Sorts a non-indexed attribute (SQL does not require a generated index)", async () => {
        // for-nano raises InternalError when sorting a non-indexed attribute; the
        // Drizzle adapter translates orderBy to plain SQL `order by`, so the
        // behavioural adaptation is that the query succeeds and is ordered.
        const repo = drizzleRepository(handle.adapter, QueryUser);
        const sorted = await repo
          .select()
          .orderBy(["name", OrderDirection.ASC])
          .execute();
        expect(sorted.map((r) => r.id)).toEqual(
          [...created].sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.id)
        );
      });
    });

    describe("default query statements", () => {
      it("finds matches using decorated default attributes", async () => {
        const matches = await stringRepo.find("ap", OrderDirection.ASC);
        expect(matches.map((record) => record.attr1)).toEqual([
          "apple",
          "apricot",
        ]);
        expect(
          matches.every(
            (record) =>
              record.attr1?.startsWith("ap") || record.attr2?.startsWith("ap")
          )
        ).toEqual(true);
      });

      it("pages defaults using decorated attributes and consistent metadata", async () => {
        const pageResult = await stringRepo.page("a", OrderDirection.DSC, {
          offset: 1,
          limit: 2,
        });

        expect(pageResult.current).toEqual(1);
        expect(pageResult.count).toEqual(6);
        expect(pageResult.total).toEqual(3);
        expect(
          pageResult.data.every(
            (record) =>
              record.attr1?.startsWith("a") || record.attr2?.startsWith("a")
          )
        ).toEqual(true);
        expect(pageResult.data.map((record) => record.attr1)).toEqual([
          "sigma",
          "omega",
        ]);
      });

      it("includes matches from non-primary default attributes and keeps ordering consistent", async () => {
        const ascMatches = await stringRepo.find("al", OrderDirection.ASC);
        const descMatches = await stringRepo.find("al", OrderDirection.DSC);

        expect(ascMatches.map((record) => record.attr1)).toEqual([
          "omega",
          "sigma",
        ]);
        expect(descMatches.map((record) => record.attr1)).toEqual([
          "sigma",
          "omega",
        ]);
        expect(
          ascMatches.every((record) => record.attr2?.startsWith("al"))
        ).toEqual(true);
        expect(
          descMatches.every((record) => record.attr2?.startsWith("al"))
        ).toEqual(true);

        const ascPage = await stringRepo.page("al", OrderDirection.ASC, {
          offset: 1,
          limit: 1,
        });
        expect(ascPage.data.map((record) => record.attr1)).toEqual(["omega"]);

        const descPage = await stringRepo.page("al", OrderDirection.DSC, {
          offset: 1,
          limit: 1,
        });
        expect(descPage.data.map((record) => record.attr1)).toEqual(["sigma"]);
      });
    });

    describe("numeric-prefixed default query strings", () => {
      const queryValue = "1";
      const expectedAscNames = [
        "10Start",
        "1Alpha",
        "1Beta",
        "1Zeta",
        "a1-Gamma",
        "foo10",
      ];
      const expectedDescNames = [...expectedAscNames].reverse();

      it("finds numeric-prefixed strings via decorated attributes and maintains consistent ordering", async () => {
        const ascMatches = await numericRepo.find(
          queryValue,
          OrderDirection.ASC
        );
        const descMatches = await numericRepo.find(
          queryValue,
          OrderDirection.DSC
        );

        expect(ascMatches.map((record) => record.searchName)).toEqual(
          expectedAscNames
        );
        expect(descMatches.map((record) => record.searchName)).toEqual(
          expectedDescNames
        );
        expect(
          ascMatches.every(
            (record) =>
              record.searchName?.startsWith(queryValue) ||
              record.searchCode?.startsWith(queryValue)
          )
        ).toEqual(true);
        expect(
          descMatches.every(
            (record) =>
              record.searchName?.startsWith(queryValue) ||
              record.searchCode?.startsWith(queryValue)
          )
        ).toEqual(true);
        expect(
          ascMatches.some((match) => match.searchName === "a1-Gamma")
        ).toEqual(true);
        expect(ascMatches.some((match) => match.searchName === "foo10")).toEqual(
          true
        );
        expect(
          ascMatches.some((match) => match.searchName === "alpha10")
        ).toEqual(false);
      });

      it("pages numeric-prefixed data across sequential page offsets", async () => {
        const pageLimit = 2;
        const expectedAscPages = [
          ["10Start", "1Alpha"],
          ["1Beta", "1Zeta"],
          ["a1-Gamma", "foo10"],
        ];

        const repoPage1 = await numericRepo.page(
          queryValue,
          OrderDirection.ASC,
          { offset: 1, limit: pageLimit }
        );
        const pageOneLastId = repoPage1.data[
          repoPage1.data.length - 1
        ].id as number;
        const repoPage2 = await numericRepo.page(
          queryValue,
          OrderDirection.ASC,
          { limit: pageLimit, bookmark: pageOneLastId },
          bookmarkCtx
        );
        const pageTwoLastId = repoPage2.data[
          repoPage2.data.length - 1
        ].id as number;
        const repoPage3 = await numericRepo.page(
          queryValue,
          OrderDirection.ASC,
          { limit: pageLimit, bookmark: pageTwoLastId },
          bookmarkCtx
        );

        const repoAscNames = [
          repoPage1.data.map((record) => record.searchName),
          repoPage2.data.map((record) => record.searchName),
          repoPage3.data.map((record) => record.searchName),
        ];

        expect(repoAscNames).toEqual(expectedAscPages);
      });

      it("pages numeric defaults in both directions with consistent metadata", async () => {
        const pageLimit = 2;
        const ascPage = await numericRepo.page(
          queryValue,
          OrderDirection.ASC,
          { offset: 1, limit: pageLimit }
        );

        expect(ascPage.current).toEqual(1);
        expect(ascPage.count).toEqual(expectedAscNames.length);
        expect(ascPage.total).toEqual(
          Math.ceil(expectedAscNames.length / pageLimit)
        );
        expect(ascPage.data.map((record) => record.searchName)).toEqual(
          expectedAscNames.slice(0, pageLimit)
        );

        const pageOneLastId = ascPage.data[ascPage.data.length - 1]
          .id as number;
        const ascPageTwo = await numericRepo.page(
          queryValue,
          OrderDirection.ASC,
          { limit: pageLimit, bookmark: pageOneLastId },
          bookmarkCtx
        );
        expect(ascPageTwo.data.map((record) => record.searchName)).toEqual(
          expectedAscNames.slice(pageLimit, pageLimit * 2)
        );

        const descPage = await numericRepo.page(
          queryValue,
          OrderDirection.DSC,
          { offset: 1, limit: pageLimit }
        );
        expect(descPage.current).toEqual(1);
        expect(descPage.count).toEqual(expectedDescNames.length);
        expect(descPage.total).toEqual(
          Math.ceil(expectedDescNames.length / pageLimit)
        );
        expect(descPage.data.map((record) => record.searchName)).toEqual(
          expectedDescNames.slice(0, pageLimit)
        );
      });
    });

    describe("GTIN prefix boundaries", () => {
      const gtin = "98765432109879";
      const nextGtin = "98765432109880";

      it("returns only the exact GTIN for find() and page()", async () => {
        const found = await productRepo.find(gtin, OrderDirection.DSC);
        const paged = await productRepo.page(gtin, OrderDirection.DSC, {
          offset: 1,
          limit: 1,
        });

        expect(found.map((product) => product.productCode)).toEqual([gtin]);
        expect(paged.data.map((product) => product.productCode)).toEqual([
          gtin,
        ]);
      });

      it("builds an exclusive LIKE prefix for find() and page() with a full GTIN ending in 9", async () => {
        const rawSpy = jest.spyOn(handle.adapter, "raw");

        const found = await productRepo.find(gtin, OrderDirection.DSC);
        const paged = await productRepo.page(gtin, OrderDirection.DSC, {
          offset: 1,
          limit: 1,
        });

        expect(found.map((product) => product.productCode)).toEqual([gtin]);
        expect(paged.data.map((product) => product.productCode)).toEqual([
          gtin,
        ]);
        expect(rawSpy).toHaveBeenCalled();

        for (const call of rawSpy.mock.calls) {
          const flat = flattenSql(call[0]);
          const sqlText = `${flat.text} ${flat.params.join(" ")}`;
          expect(sqlText.toLowerCase()).toContain("like");
          expect(sqlText).toContain(`${gtin}%`);
          // The exclusive upper bound is inherent to the prefix match: the next
          // GTIN (`${nextGtin}`) is never selected.
          expect(sqlText).not.toContain(nextGtin);
        }

        rawSpy.mockRestore();
      });
    });
  });
}

dialectSuite(
  "query operators and default queries (sqlite)",
  "sqlite",
  () => createSqliteAdapter()
);

if (hasMysql()) {
  dialectSuite(
    "query operators and default queries (mysql)",
    "mysql",
    () => createMysqlAdapter()
  );
} else {
  console.warn(
    "[drizzle-tests] MYSQL_URI not set: mysql query coverage not exercised"
  );
}
