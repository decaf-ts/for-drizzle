import { Model } from "@decaf-ts/decorator-validation";
import { InternalError } from "@decaf-ts/db-decorators";
import {
  AdapterFlags,
  Condition,
  GroupOperator,
  Operator,
  OrderDirection,
  QueryError,
  Statement,
  UnsupportedError,
} from "@decaf-ts/core";
import {
  Column,
  SQL,
  Table,
  and,
  asc,
  desc,
  eq,
  getTableName,
  gt,
  gte,
  inArray,
  is,
  like,
  lt,
  lte,
  ne,
  not,
  or,
  sql,
} from "drizzle-orm";
import { DrizzleAdapter } from "../DrizzleAdapter";
import { DrizzleQuery } from "../types";
import { translateModel } from "../schema/translation";

/**
 * @description Statement builder for the Drizzle adapter
 * @summary Translates the decaf statement DSL (select/from/where/orderBy/limit/
 * offset/aggregations) into a Drizzle `SQL` query object. Conditions are compiled
 * to drizzle operator expressions, and column references are resolved through the
 * generated schema so that decaf property names map to physical columns.
 * @template M The model type
 * @template R The expected result type
 * @class DrizzleStatement
 * @memberOf module:for-drizzle
 */
export class DrizzleStatement<M extends Model, R>
  extends Statement<M, DrizzleAdapter, R, DrizzleQuery>
{
  constructor(adapter: DrizzleAdapter, overrides?: Partial<AdapterFlags>) {
    super(adapter, overrides);
  }

  /**
   * @description Resolves the generated schema for the statement's model
   * @summary Lazily translates the model decoration metadata into a Drizzle
   * schema for the adapter's dialect.
   * @return {DrizzleSchema} The generated schema
   */
  protected get schema() {
    if (!this.fromSelector)
      throw new InternalError(
        "Drizzle statements require a model. Call from() before executing."
      );
    return translateModel(
      this.fromSelector,
      this.adapter.config.dialect
    );
  }

  /**
   * @description Resolves the Drizzle column for a model attribute
   * @summary Maps the attribute (accepting either the model property name or the
   * physical column name) onto the generated table's column builder.
   * @param {string} attr The model attribute to resolve
   * @return {any} The Drizzle column builder
   * @throws {QueryError} When the attribute is not part of the translated schema
   */
  private resolveColumn(attr: string): any {
    const schema = this.schema;
    const prop = schema.propertyNames[attr] ?? attr;
    const column = schema.table[prop];
    if (!column)
      throw new QueryError(
        `Unknown column "${attr}" for table ${schema.tableName}`
      );
    return column;
  }

  /**
   * @description Compiles a decaf condition into a Drizzle SQL expression
   * @summary Recursively handles the group operators (`AND`/`OR`/`NOT`) and maps
   * the comparison operators to the dialect-specific Drizzle equivalents
   * (`eq`, `gt`, `like`, `inArray`, ...), including `NULL`-aware equality, the
   * unary `EXISTS` existence check (`IS NULL` when negated, `IS NOT NULL`
   * otherwise) and the PostgreSQL `~` regular-expression operator.
   * @param {Condition<M>} condition The decaf condition to compile
   * @return {SQL} The Drizzle SQL expression
   * @throws {QueryError} When a comparison or nested condition is malformed
   * @throws {UnsupportedError} When the operator has no Drizzle equivalent
   */
  protected override parseCondition(condition: Condition<M>): SQL {
    const { attr1, operator, comparison } = condition as unknown as {
      attr1: string | Condition<M>;
      operator: Operator | GroupOperator;
      comparison: any;
    };

    if (operator === GroupOperator.AND) {
      const left =
        attr1 instanceof Condition
          ? this.parseCondition(attr1 as Condition<M>)
          : undefined;
      const right =
        comparison instanceof Condition
          ? this.parseCondition(comparison as Condition<M>)
          : undefined;
      return and(left, right) as SQL;
    }

    if (operator === GroupOperator.OR) {
      const left =
        attr1 instanceof Condition
          ? this.parseCondition(attr1 as Condition<M>)
          : undefined;
      const right =
        comparison instanceof Condition
          ? this.parseCondition(comparison as Condition<M>)
          : undefined;
      return or(left, right) as SQL;
    }

    if (operator === Operator.NOT) {
      if (!(attr1 instanceof Condition))
        throw new QueryError("NOT operator requires a nested condition");
      return not(this.parseCondition(attr1 as Condition<M>));
    }

    const column = this.resolveColumn(attr1 as string);
    switch (operator) {
      case Operator.EXISTS:
        // EXISTS is a unary condition: it carries no comparison value to bind.
        // The condition's `comparison` drives the nullability check, matching the
        // EQUAL/DIFFERENT null handling below and for-typeorm's mapping:
        // `exists(true)` (the default) maps to a portable `IS NOT NULL`, while the
        // supported negation path `exists(false)` maps to `IS NULL`.
        return comparison === false
          ? sql`${column} is null`
          : sql`${column} is not null`;
      case Operator.EQUAL:
        return comparison === null ? sql`${column} is null` : eq(column, comparison);
      case Operator.DIFFERENT:
        return comparison === null
          ? sql`${column} is not null`
          : ne(column, comparison);
      case Operator.BIGGER:
        return gt(column, comparison);
      case Operator.BIGGER_EQ:
        return gte(column, comparison);
      case Operator.SMALLER:
        return lt(column, comparison);
      case Operator.SMALLER_EQ:
        return lte(column, comparison);
      case Operator.IN: {
        if (!Array.isArray(comparison))
          throw new QueryError(
            `IN operator requires an array, got: ${typeof comparison}`
          );
        return inArray(column, comparison);
      }
      case Operator.BETWEEN: {
        if (!Array.isArray(comparison) || comparison.length !== 2)
          throw new QueryError(
            `BETWEEN operator requires [min, max], got: ${String(comparison)}`
          );
        const [min, max] = comparison;
        return and(gte(column, min), lte(column, max)) as SQL;
      }
      case Operator.REGEXP:
        // PostgreSQL spells the regular-expression match operator `~`; SQLite and
        // MySQL use the `REGEXP` keyword.
        return this.adapter.config.dialect === "postgres"
          ? sql`${column} ~ ${comparison}`
          : sql`${column} regexp ${comparison}`;
      case Operator.STARTS_WITH:
        return like(column, `${comparison}%`);
      case Operator.ENDS_WITH:
        return like(column, `%${comparison}`);
      default:
        throw new UnsupportedError(
          `Unsupported operator for Drizzle: ${String(operator)}`
        );
    }
  }

  /**
   * @description Builds the plain selection query
   * @summary Assembles the `select`/`from` projection (aliased by model property
   * name when a subset of properties is selected), then appends the compiled
   * `where`, `group by`, `order by`, `limit` and `offset` clauses in order.
   * @return {DrizzleQuery} The Drizzle `SQL` selection query
   */
  private buildSelect(): DrizzleQuery {
    const schema = this.schema;
    const table = schema.table;

    const selection =
      this.selectSelector && this.selectSelector.length
        ? sql.join(
            this.selectSelector.map(
              (prop) =>
                sql`${table[prop as string]} as ${sql.identifier(String(prop))}`
            ),
            sql`, `
          )
        : sql`*`;

    let query: SQL = sql`select ${selection} from ${table}`;

    if (this.whereCondition)
      query = sql`${query} where ${this.parseCondition(this.whereCondition)}`;

    if (this.groupBySelectors && this.groupBySelectors.length) {
      query = sql`${query} group by ${sql.join(
        this.groupBySelectors.map((prop) => sql`${table[prop as string]}`),
        sql`, `
      )}`;
    }

    if (this.orderBySelectors && this.orderBySelectors.length) {
      query = sql`${query} order by ${sql.join(
        this.orderBySelectors.map(([prop, direction]) =>
          direction === OrderDirection.DSC
            ? desc(table[prop as string])
            : asc(table[prop as string])
        ),
        sql`, `
      )}`;
    }

    if (typeof this.limitSelector === "number")
      query = sql`${query} limit ${this.limitSelector}`;
    if (typeof this.offsetSelector === "number")
      query = sql`${query} offset ${this.offsetSelector}`;

    return query;
  }

  /**
   * @description Executes an aggregation query
   * @summary Aggregations return raw scalar values and bypass model reversion.
   */
  protected buildAggregation(): DrizzleQuery {
    const schema = this.schema;
    const table = schema.table;
    let query: SQL;

    if (typeof this.countSelector !== "undefined") {
      if (this.countSelector === null) {
        query = sql`select count(*) as ${sql.identifier("count")} from ${table}`;
      } else {
        const column = this.resolveColumn(this.countSelector as string);
        query = sql`select count(${column}) as ${sql.identifier(
          "count"
        )} from ${table}`;
      }
    } else if (this.countDistinctSelector) {
      const column = this.resolveColumn(this.countDistinctSelector as string);
      query = sql`select count(distinct ${column}) as ${sql.identifier(
        "count"
      )} from ${table}`;
    } else if (this.sumSelector) {
      const column = this.resolveColumn(this.sumSelector as string);
      query = sql`select sum(${column}) as ${sql.identifier(
        "sum"
      )} from ${table}`;
    } else if (this.avgSelector) {
      const column = this.resolveColumn(this.avgSelector as string);
      query = sql`select avg(${column}) as ${sql.identifier(
        "avg"
      )} from ${table}`;
    } else if (this.minSelector) {
      const column = this.resolveColumn(this.minSelector as string);
      query = sql`select min(${column}) as ${sql.identifier(
        "min"
      )} from ${table}`;
    } else if (this.maxSelector) {
      const column = this.resolveColumn(this.maxSelector as string);
      query = sql`select max(${column}) as ${sql.identifier(
        "max"
      )} from ${table}`;
    } else if (this.distinctSelector) {
      const column = this.resolveColumn(this.distinctSelector as string);
      query = sql`select distinct ${column} from ${table}`;
    } else {
      throw new InternalError("No aggregation selector defined");
    }

    if (this.whereCondition)
      query = sql`${query} where ${this.parseCondition(this.whereCondition)}`;
    return query;
  }

  /**
   * @description Detects whether the statement is a true aggregation
   * @summary A bare `groupBy` (without `count`/`sum`/`avg`/`min`/`max`/`distinct`)
   * is a plain projection grouped in SQL; core treats any `groupBy` as an
   * aggregation, but Drizzle needs to run it through the normal select path so the
   * grouped rows are reverted and grouped into a `Record` keyed by the grouped
   * attribute.
   * @return {boolean} True when an aggregation selector is present
   */
  protected override hasAggregation(): boolean {
    const pureGroupBy =
      (this.groupBySelectors?.length || 0) > 0 &&
      typeof this.countSelector === "undefined" &&
      typeof this.countDistinctSelector === "undefined" &&
      typeof this.maxSelector === "undefined" &&
      typeof this.minSelector === "undefined" &&
      typeof this.sumSelector === "undefined" &&
      typeof this.avgSelector === "undefined" &&
      typeof this.distinctSelector === "undefined";
    return pureGroupBy ? false : super.hasAggregation();
  }

  /**
   * @description Builds the Drizzle query
   * @summary Returns either a plain selection query or an aggregation query
   * depending on which selectors are set.
   * @return {DrizzleQuery} The Drizzle `SQL` query object
   */
  override build(): DrizzleQuery {
    if (this.hasAggregation()) return this.buildAggregation();
    return this.buildSelect();
  }

  /**
   * @description Strips quoting and schema qualification from an identifier
   * @summary Reduces a serialized SQL identifier (`"table"`, `` `table` ``,
   * `"schema"."table"`, `[table]`) to its bare, lower-cased table name so the
   * raw-query scope check can compare references regardless of dialect quoting.
   * @param {string} reference The serialized identifier
   * @return {string} The normalised table name
   */
  private static normalizeIdentifier(reference: string): string {
    const segment = reference.split(".").pop() ?? reference;
    return segment
      .replace(/^["`[]+/, "")
      .replace(/["`\]]+$/, "")
      .trim()
      .toLowerCase();
  }

  /**
   * @description Collects the physical tables referenced by a Drizzle chunk tree
   * @summary Walks `queryChunks` recursively and records the table behind every
   * `Table`/`Column` node. This catches references interpolated as Drizzle
   * objects even when the serialized SQL cannot be inspected.
   * @param {unknown} chunk The chunk to inspect
   * @param {Set<string>} out The accumulator of referenced table names
   * @return {void}
   */
  private static collectReferencedTables(
    chunk: unknown,
    out: Set<string>
  ): void {
    if (!chunk) return;
    if (Array.isArray(chunk)) {
      for (const entry of chunk)
        DrizzleStatement.collectReferencedTables(entry, out);
      return;
    }
    if (is(chunk as any, Table)) {
      out.add(getTableName(chunk as Table));
      return;
    }
    if (is(chunk as any, Column)) {
      out.add(getTableName((chunk as Column).table));
      return;
    }
    const nested = (chunk as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(nested)) {
      for (const entry of nested)
        DrizzleStatement.collectReferencedTables(entry, out);
    }
  }

  /**
   * @description Enforces that a raw query only touches the statement's own table
   * @summary Serialises the query with the adapter's dialect and rejects any
   * table reference other than the statement's own table. Drizzle object
   * references are additionally caught by walking the query chunks, so an
   * interpolated foreign table is rejected even when serialisation is
   * unavailable. The check fails closed: a query whose SQL cannot be serialised
   * is rejected rather than forwarded.
   * @param {DrizzleQuery} query The raw query to validate
   * @return {void}
   * @throws {UnsupportedError} When the query references another table
   */
  private assertOwnTableOnly(query: DrizzleQuery): void {
    if (!this.fromSelector)
      throw new UnsupportedError(
        "Statement.raw() requires a model scope; call from() before raw(), or use adapter.raw() for unrestricted raw execution"
      );
    const ownTable = this.schema.tableName;
    const own = DrizzleStatement.normalizeIdentifier(ownTable);
    const referenced = new Set<string>();
    const db: any = this.adapter.config.db;
    const dialect = db?.dialect;
    if (!dialect || typeof dialect.sqlToQuery !== "function")
      throw new UnsupportedError(
        "Statement.raw() cannot verify the query scope for this adapter"
      );
    let serialized: string;
    try {
      serialized = dialect.sqlToQuery(query).sql;
    } catch (e: unknown) {
      throw new UnsupportedError(
        `Statement.raw() could not serialise the query to verify its scope: ${
          (e as Error)?.message ?? String(e)
        }`
      );
    }
    const tableReference =
      /\b(?:from|join|into|update|references|truncate)\s+(\?|\$\d+|:\w+|@\w+|(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w$]+)(?:\s*\.\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w$]+))?)/gi;
    let match: RegExpExecArray | null;
    while ((match = tableReference.exec(serialized)) !== null) {
      const token = match[1];
      if (
        !token ||
        token === "?" ||
        token.startsWith("$") ||
        token.startsWith(":") ||
        token.startsWith("@")
      )
        throw new UnsupportedError(
          "Statement.raw() cannot verify a table referenced through a bound parameter; use adapter.raw() for unrestricted raw execution"
        );
      referenced.add(token);
    }
    DrizzleStatement.collectReferencedTables(query, referenced);
    for (const reference of referenced) {
      if (DrizzleStatement.normalizeIdentifier(reference) !== own)
        throw new UnsupportedError(
          `Statement.raw() is scoped to table "${ownTable}" and cannot reference "${reference}"; use adapter.raw() for unrestricted raw execution`
        );
    }
  }

  /**
   * @description Executes a raw query scoped to the statement's own table
   * @summary `Statement.raw()` forwards the caller's query to `adapter.raw()`,
   * so without a scope check a repository for one table could dump another
   * table's rows. Raw SQL strings are rejected outright: the documented
   * unrestricted raw surface is `adapter.raw()`. Drizzle `SQL` objects are
   * verified to reference no table other than the statement's own table before
   * execution, so a repository cannot read another table through a statement.
   * @template R The expected result type
   * @param {DrizzleQuery | string} rawInput The raw query to execute
   * @param {...any[]} args Contextual arguments
   * @return {Promise<R>} The scoped statement result
   * @throws {UnsupportedError} When raw statements are disabled or the query
   * references a table other than the statement's own table
   */
  override async raw<R>(
    rawInput: DrizzleQuery | string,
    ...args: any[]
  ): Promise<R> {
    const { ctx, ctxArgs } = this.logCtx(args, this.raw);
    const allowRawStatements = ctx.get("allowRawStatements");
    if (!allowRawStatements)
      throw new UnsupportedError(
        "Raw statements are not allowed in the current configuration"
      );
    if (typeof rawInput === "string")
      throw new UnsupportedError(
        "Statement.raw() does not accept raw SQL strings; use adapter.raw() for unrestricted raw execution"
      );
    this.assertOwnTableOnly(rawInput);
    const results: any = await this.adapter.raw(rawInput, true, ...ctxArgs);
    return results as R;
  }

  /**
   * @description Reverts a raw row into a model
   * @summary Projected selections alias their columns by model property name,
   * so rows arrive property-keyed; the adapter's `revertRow` remaps them to the
   * physical column names expected by decaf's `Adapter.revert`.
   * @param {any} record The raw row
   * @param {any} ctx The active context
   * @return {M} The reconstructed model
   */
  protected override processRecord(record: any, ctx: any): M {
    return (this.adapter as DrizzleAdapter).revertRow<M>(
      record,
      this.fromSelector as any,
      ctx
    );
  }

  /**
   * @description Groups reverted rows by the group-by attribute
   * @summary A bare `groupBy` query must yield a `Record` keyed by the grouped
   * attribute (matching for-nano), rather than a flat array of rows.
   * @param {any} value The raw query results
   * @param {Function} processor The row-to-model processor
   * @return {any} The grouped results keyed by the grouped attribute
   */
  protected override revertGroupedResults(
    value: any,
    processor: (record: any) => any
  ): any {
    if (!Array.isArray(value)) return super.revertGroupedResults(value, processor);
    const [primary] = this.groupBySelectors ?? [];
    if (!primary) return super.revertGroupedResults(value, processor);
    return value.reduce<Record<string, any[]>>((acc, row) => {
      const model = processor(row) as any;
      const key = String(model?.[primary as string]);
      (acc[key] = acc[key] ?? []).push(model);
      return acc;
    }, {});
  }

  /**
   * @description Drizzle handles statement preparation internally
   * @summary The adapter builds and executes SQL at call time; no separate
   * prepared-statement squashing is required, so this is a no-op that keeps the
   * statement in raw execution mode.
   * @return {this} The statement itself
   */
  override async prepare(): Promise<this> {
    return this;
  }

  /**
   * @description Executes the statement and normalises aggregation results
   * @summary Scalar aggregations are returned as numbers (and `max`/`min` as their
   * raw value) instead of the driver's `{ count }`/`{ sum }` row envelope.
   * @param {...any[]} args Contextual arguments
   * @return {Promise<R>} The statement result
   */
  override async execute(...args: any[]): Promise<R> {
    const result = await super.execute(...(args as []));
    if (!this.hasAggregation()) return result as R;
    if (this.groupBySelectors && this.groupBySelectors.length)
      return result as R;
    const row = (Array.isArray(result) ? result[0] : result) as any;
    if (
      typeof this.countSelector !== "undefined" ||
      typeof this.countDistinctSelector !== "undefined"
    )
      return Number(row?.count ?? 0) as R;
    if (this.sumSelector) return Number(row?.sum ?? 0) as R;
    if (this.avgSelector) return Number(row?.avg ?? 0) as R;
    if (this.maxSelector) return row?.max as R;
    if (this.minSelector) return row?.min as R;
    if (this.distinctSelector) {
      const prop = this.distinctSelector as string;
      const dbName = this.schema.columns[prop]?.dbName ?? prop;
      const rows = Array.isArray(result) ? result : [result];
      return rows.map((r: any) => r?.[dbName]) as R;
    }
    return result as R;
  }
}
