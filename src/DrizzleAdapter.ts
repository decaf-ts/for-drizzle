import {
  Adapter,
  AdapterFlags,
  BaseModel,
  ContextLock,
  ContextOf,
  ContextualArgs,
  Paginator,
  PersistenceKeys,
  RawResult,
  Repository,
  Sequence,
  SequenceModel,
  SequenceOptions,
  UnsupportedError,
} from "@decaf-ts/core";
import {
  BaseError,
  DBOperations,
  NotFoundError,
  onCreate,
  onCreateUpdate,
  timestamp,
} from "@decaf-ts/db-decorators";
import { PrimaryKeyType } from "@decaf-ts/db-decorators";
import {
  DEFAULT_ERROR_MESSAGES,
  Model,
  ValidationKeys,
} from "@decaf-ts/decorator-validation";
import {
  Constructor,
  Decoration,
  DefaultFlavour,
  propMetadata,
} from "@decaf-ts/decoration";
import { eq, sql } from "drizzle-orm";
import { RE2 } from "re2-wasm";
import { DrizzleFlavour, SQL_TIMESTAMP_FORMAT } from "./constants";
import { DrizzleConfig, DrizzleContext, DrizzleDatabase, DrizzleQuery } from "./types";
import { isDuplicateIndexError, parseError } from "./errors";
import { DrizzleStatement } from "./query/Statement";
import { DrizzlePaginator } from "./query/Paginator";
import { DrizzleContextLock } from "./DrizzleContextLock";
import { DrizzleSequence } from "./sequences/DrizzleSequence";
import {
  DrizzleColumnType,
  DrizzleSchema,
  translateModel,
} from "./schema/translation";
import { generateDDL } from "./indexes/generator";

/**
 * @description Sets the creator/updater field from the user in the context
 * @summary Ownership handler registered for the Drizzle flavour. Reads the `user`
 * property from the operation context and writes it (or its `name`) to the
 * decorated `createdBy`/`updatedBy` property. Throws
 * {@link UnsupportedError} when the context carries no user, matching the
 * Nano/TypeORM adapter behaviour.
 * @template M The model type
 * @template R The Drizzle repository type
 * @template V The metadata type
 * @param {ContextOf<R>} context The operation context
 * @param {V} data The relation metadata
 * @param {string} key The ownership property key
 * @param {M} model The model being created or updated
 * @return {Promise<void>} Resolves when the property has been set
 * @function createdByOnDrizzleCreateUpdate
 * @memberOf module:for-drizzle
 */
export async function createdByOnDrizzleCreateUpdate<
  M extends Model,
  R extends Repository<M, DrizzleAdapter>,
  V extends Record<string, any>,
>(
  this: R,
  context: ContextOf<R>,
  data: V,
  key: keyof M,
  model: M
): Promise<void> {
  try {
    const user = context.get("user") as { name?: string } | string;
    model[key] = ((user as { name?: string })?.name || user) as M[typeof key];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    throw new UnsupportedError(
      "No User found in context. Please provide a user in the context"
    );
  }
}

/**
 * @description Resolves decaf's default `@date()` property decorator
 * @summary The default date decoration is registered by `decorator-validation`
 * under the default flavour. The Drizzle override needs to reuse that exact
 * parsing behaviour while forcing a SQL-safe format, so the registered decorator is
 * looked up lazily from the decoration registry instead of being duplicated.
 * @return {Function} The default date decorator factory
 * @function defaultDateDecorator
 * @memberOf module:for-drizzle
 */
function defaultDateDecorator(): (...args: any[]) => PropertyDecorator {
  const registry = (
    Decoration as unknown as {
      decorators?: Record<
        string,
        Record<
          string,
          { decorators?: Set<{ decorator: (...args: any[]) => PropertyDecorator }> }
        >
      >;
    }
  ).decorators;
  const entry =
    registry?.[ValidationKeys.DATE]?.[DefaultFlavour]?.decorators;
  if (!entry || !entry.size)
    throw new UnsupportedError(
      "decaf's default @date() decoration is not registered"
    );
  return [...entry.values()][0].decorator;
}

/**
 * @description Builds a SQL-safe `@date()` decorator factory
 * @summary Wraps decaf's default date decorator but forces
 * {@link SQL_TIMESTAMP_FORMAT}. SQLite and MySQL `DATETIME` columns reject the
 * default `dd-MM-yyyy HH:mm:ss:S` format, which is why the adapter overrides
 * `@date()` (and the `@timestamp`/`@createdAt`/`@updatedAt` decorations that
 * delegate to it) for the Drizzle flavour.
 * @param {string} format The format requested by the model decoration (ignored)
 * @param {string} message The validation error message
 * @return {PropertyDecorator} The SQL-safe date property decorator
 * @function sqlSafeDateDec
 * @memberOf module:for-drizzle
 */
function sqlSafeDateDec(format: string, message: string): PropertyDecorator {
  void format;
  return (target: object, propertyKey?: any) =>
    defaultDateDecorator()(SQL_TIMESTAMP_FORMAT, message)(
      target,
      propertyKey
    );
}

/**
 * @description Drizzle persistence adapter for decaf-ts
 * @summary Binds decaf models to Drizzle ORM. The adapter is schema-first:
 * decaf model decoration metadata is translated into dialect-specific Drizzle
 * tables by {@link translateModel}, and CRUD operations use the resulting schema
 * while validation remains owned by decaf's `decorator-validation`. All three
 * supported Drizzle dialects — `better-sqlite3` (SQLite), `mysql2` (MySQL) and
 * `node-postgres` (PostgreSQL) — are supported.
 * @template M The model type
 * @class DrizzleAdapter
 * @example
 * ```typescript
 * const db = drizzle(sqlite);
 * const adapter = new DrizzleAdapter({ dialect: "sqlite", db });
 * await adapter.initialize();
 * ```
 * @mermaid
 * sequenceDiagram
 *   participant R as Repository
 *   participant A as DrizzleAdapter
 *   participant T as translateModel
 *   participant DB as Drizzle
 *   R->>A: create(model)
 *   A->>T: translateModel(model, dialect)
 *   T-->>A: DrizzleSchema
 *   A->>DB: insert(schema.table).values(...)
 *   DB-->>A: ok
 *   A-->>R: record
 * @memberOf module:for-drizzle
 */
export class DrizzleAdapter extends Adapter<
  DrizzleConfig,
  DrizzleDatabase,
  DrizzleQuery,
  DrizzleContext
> {
  constructor(config: DrizzleConfig, alias?: string) {
    super(config, DrizzleFlavour, alias);
  }

  /**
   * @description Initialises the adapter and its SQLite extensions
   * @summary `better-sqlite3` does not ship a `REGEXP` implementation, so
   * decaf's `REGEXP` condition would fail with `no such function: regexp`.
   * When the raw SQLite client is available, register a `regexp` function that
   * tests the column value against the supplied pattern using Google's RE2
   * (linear-time, `re2-wasm`). Unlike the previous `RegExp`-based matcher, RE2
   * cannot backtrack catastrophically, so a user-supplied pattern such as
   * `(a+)+b` can no longer block the event loop. RE2 runs in Unicode mode and
   * therefore rejects patterns using lookaround or backreferences that the native
   * `RegExp` engine would accept.
   * @param {...any[]} args Contextual arguments
   * @return {Promise<void>} Resolves once the adapter is initialised
   */
  override async initialize(...args: any[]): Promise<void> {
    if (this.dialect === "sqlite") {
      const client: any = this.config.client;
      if (client && typeof client.function === "function") {
        try {
          client.function(
            "regexp",
            { deterministic: true },
            (pattern: string, value: unknown) =>
              new RE2(pattern, "u").test(String(value ?? "")) ? 1 : 0
          );
        } catch {
          // the function is already registered on this connection
        }
      }
    }
    return super.initialize(...args);
  }

  /**
   * @description Creates a configuration-scoped adapter proxy
   * @summary The base implementation keys proxies by a recursive hash of the
   * configuration. Drizzle configurations embed the live database and driver
   * handles, which are circular, so hashing recurses until the stack overflows.
   * The live handles are temporarily hidden from the hash (as non-enumerable
   * properties on a shallow copy) and restored before the proxy is returned, so
   * `for` accepts circular configurations while the proxy still receives them.
   * @param {Partial<DrizzleConfig>} config The configuration overrides
   * @param {...any[]} args Contextual arguments
   * @return {this} The configuration-scoped adapter proxy
   */
  override for(config: Partial<DrizzleConfig>, ...args: any[]): this {
    const clone: Partial<DrizzleConfig> = { ...config };
    const hidden: [string, PropertyDescriptor][] = [];
    for (const key of ["db", "client"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(clone, key);
      if (descriptor && descriptor.enumerable) {
        hidden.push([key, descriptor]);
        Object.defineProperty(clone, key, {
          ...descriptor,
          enumerable: false,
        });
      }
    }
    try {
      return super.for(clone, ...args);
    } finally {
      hidden.forEach(([key, descriptor]) =>
        Object.defineProperty(clone, key, descriptor)
      );
    }
  }

  /**
   * @description Returns the underlying Drizzle database instance
   * @summary The consumer constructs the Drizzle database (and its driver) and
   * passes it through {@link DrizzleConfig}; the adapter never builds connections.
   * @return {DrizzleDatabase} The Drizzle database
   */
  protected getClient(): DrizzleDatabase {
    return this.config.db;
  }

  /**
   * @description The active SQL dialect
   * @return {DrizzleDialect} The configured dialect
   */
  get dialect() {
    return this.config.dialect;
  }

  /**
   * @description The Drizzle database instance, typed loosely
   * @summary The SQLite and MySQL Drizzle database types do not share a common
   * insert/update surface, so the adapter accesses it through `any` internally.
   * @return {any} The Drizzle database
   */
  private get db(): any {
    return this.config.db;
  }

  /**
   * @description Resolves the translated schema for a model
   * @summary Convenience wrapper around {@link translateModel} bound to the
   * adapter's dialect.
   * @template M The model type
   * @param {Constructor<M>} model The decaf model
   * @return {DrizzleSchema<M>} The translated schema
   */
  schema<M extends Model>(model: Constructor<M>): DrizzleSchema<M> {
    return translateModel(model, this.dialect);
  }

  /**
   * @description Returns the physical primary key column name
   * @template M The model type
   * @param {Constructor<M>} model The decaf model
   * @return {string} The database column name of the primary key
   */
  pkColumnName<M extends Model>(model: Constructor<M>): string {
    return this.schema(model).pkDbName;
  }

  /**
   * @description Executes a query and returns the resulting rows
   * @summary Dispatches to the synchronous `better-sqlite3` `.all()` or the
   * promise-based `mysql2` `execute()` depending on the dialect.
   * @param {DrizzleQuery} query The Drizzle SQL query
   * @return {Promise<any[]>} The resulting rows
   */
  protected async selectRows(query: DrizzleQuery): Promise<any[]> {
    const db: any = this.db;
    if (this.dialect === "sqlite") {
      try {
        return db.all(query);
      } catch {
        // better-sqlite3 throws when a statement (DDL/DML) returns no rows
        db.run(query);
        return [];
      }
    }
    const result: any = await db.execute(query);
    // node-postgres resolves with a `QueryResult` (`{ rows, ... }`), while
    // mysql2 resolves with `[rows, fields]`.
    if (this.dialect === "postgres") return result?.rows ?? result;
    return Array.isArray(result) ? result[0] : result;
  }

  /**
   * @description Executes a query that returns no rows
   * @summary Used for DDL and DML statements where `selectRows` would fail on
   * the synchronous `better-sqlite3` driver.
   * @param {DrizzleQuery} query The Drizzle SQL query
   * @return {Promise<void>} Resolves when the statement completes
   */
  protected async executeRaw(query: DrizzleQuery): Promise<void> {
    const db: any = this.db;
    if (this.dialect === "sqlite") {
      db.run(query);
      return;
    }
    await db.execute(query);
  }

  /**
   * @description Executes a mutation builder
   * @param {any} builder The Drizzle mutation builder
   * @return {Promise<void>} Resolves when the mutation completes
   */
  protected async mutate(builder: any): Promise<void> {
    if (this.dialect === "sqlite") {
      builder.run();
      return;
    }
    await builder;
  }

  /**
   * @description Checks whether an attribute name is reserved
   * @summary Blocks the framework-owned `??` markers (used for decaf-managed
   * tables such as the sequence model) from being claimed by a model property.
   * Allowing a property to map to `??table` would let a crafted record target
   * framework tables instead of its own.
   * @param {string} attr The attribute/column name to check
   * @return {boolean} True when the name is reserved
   */
  protected override isReserved(attr: string): boolean {
    if (super.isReserved(attr)) return true;
    return typeof attr === "string" && attr.startsWith("??");
  }

  /**
   * @description Maps a prepared (db-keyed) record into Drizzle property keys
   * @summary `Adapter.prepare` emits physical column names while Drizzle query
   * builders key values by the table's property names, so the record is remapped
   * before being handed to a builder.
   * @param {DrizzleSchema} schema The translated schema
   * @param {Record<string, any>} record The prepared record
   * @return {Record<string, any>} The property-keyed record
   */
  protected toProperties(
    schema: DrizzleSchema,
    record: Record<string, any>
  ): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "undefined") continue;
      const prop = schema.propertyNames[key] ?? key;
      out[prop] = this.normalizeValue(schema.columns[prop]?.type, value);
    }
    return out;
  }

  /**
   * @description Maps a Drizzle row into a db-keyed record
   * @summary `Adapter.revert` expects records keyed by physical column names,
   * while Drizzle returns rows keyed by property names.
   * @param {DrizzleSchema} schema The translated schema
   * @param {Record<string, any>} row The Drizzle row
   * @return {Record<string, any>} The db-keyed record
   */
  protected toDbRecord(
    schema: DrizzleSchema,
    row: Record<string, any>
  ): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) {
      const def =
        schema.columns[key] ??
        Object.values(schema.columns).find((c) => c.dbName === key);
      const dbName = def?.dbName ?? schema.columnNames[key] ?? key;
      out[dbName] = this.revertValue(def?.type, value);
    }
    return out;
  }

  /**
   * @description Coerces a raw driver value back to its model type
   * @summary Drizzle is executed through the raw driver, so column modes
   * (`timestamp_ms`, `boolean`) are not applied: SQLite returns numbers and
   * MySQL returns strings/numbers. Restore `Date` and `boolean` values so the
   * reverted model satisfies its validation rules.
   * @param {DrizzleColumnType} [type] The declared column type
   * @param {any} value The raw driver value
   * @return {any} The coerced value
   */
  protected revertValue(type: DrizzleColumnType | undefined, value: any): any {
    if (value === null || typeof value === "undefined") return value;
    switch (type) {
      case "date":
        return value instanceof Date ? value : new Date(value as any);
      case "boolean":
        if (typeof value === "boolean") return value;
        if (typeof value === "number") return value !== 0;
        if (typeof value === "bigint") return value !== BigInt(0);
        if (typeof value === "string")
          return value === "1" || value.toLowerCase() === "true";
        return Boolean(value);
      case "object":
        if (typeof value !== "string") return value;
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      default:
        return value;
    }
  }

  /**
   * @description Normalises a relation value for storage
   * @summary Replaces model-valued relations with their primary key so the
   * foreign-key column receives a scalar.
   * @param {DrizzleColumnType} type The column type
   * @param {any} value The value to normalise
   * @return {any} The normalised value
   */
  protected normalizeValue(type: DrizzleColumnType | undefined, value: any): any {
    if (value instanceof Model) {
      const ctor = value.constructor as Constructor<Model>;
      return (value as any)[Model.pk(ctor)];
    }
    if (
      type === "object" &&
      this.dialect === "sqlite" &&
      value !== null &&
      typeof value === "object" &&
      typeof value !== "undefined"
    ) {
      return JSON.stringify(value);
    }
    return value;
  }

  /**
   * @description Reverts a raw Drizzle row into a model
   * @summary Maps the property-keyed row to physical column names and delegates
   * to `Adapter.revert`.
   * @template M The model type
   * @param {Record<string, any>} row The raw row
   * @param {Constructor<M>} clazz The model constructor
   * @param {Context<any>} ctx The active context
   * @return {M} The reconstructed model
   */
  revertRow<M extends Model>(
    row: Record<string, any>,
    clazz: Constructor<M>,
    ctx: any
  ): M {
    const schema = this.schema(clazz);
    const id = row[schema.pk] ?? row[schema.pkDbName];
    return this.revert(this.toDbRecord(schema, row), clazz, id, undefined, ctx);
  }

  /**
   * @description Creates a statement builder for a model
   * @template M The model type
   * @param {Partial<AdapterFlags>} [overrides] Adapter flag overrides
   * @return {Statement} The Drizzle statement
   */
  override Statement<M extends Model>(overrides?: Partial<AdapterFlags>) {
    return new DrizzleStatement<M, any>(this, overrides);
  }

  /**
   * @description Creates a paginator for a query
   * @template M The model type
   * @param {DrizzleQuery | PreparedStatement<M>} query The query to paginate
   * @param {number} size The page size
   * @param {Constructor<M>} clazz The model constructor
   * @param {Partial<AdapterFlags>} [overrides] Adapter flag overrides
   * @return {Paginator} The Drizzle paginator
   */
  override Paginator<M extends Model>(
    query: DrizzleQuery | any,
    size: number,
    clazz: Constructor<M>,
    overrides?: Partial<AdapterFlags>
  ): Paginator<M, any, DrizzleQuery> {
    void overrides;
    return new DrizzlePaginator<M>(this, query, size, clazz);
  }

  /**
   * @description Returns the transaction lock
   * @param {...any[]} args Optional lock arguments
   * @return {DrizzleContextLock} A fresh transaction lock
   */
  override transactionLock(...args: any[]): ContextLock<this> {
    return new DrizzleContextLock(this, ...args) as unknown as ContextLock<this>;
  }

  /**
   * @description Creates a sequence generator
   * @param {SequenceOptions} options Sequence options
   * @param {Partial<AdapterFlags>} [overrides] Adapter flag overrides
   * @return {Promise<Sequence>} The Drizzle sequence
   */
  override async Sequence(
    options: SequenceOptions,
    overrides?: Partial<AdapterFlags>
  ): Promise<Sequence> {
    return new DrizzleSequence(options, this, overrides);
  }

  /**
   * @description Materialises the model schemas and indexes
   * @summary Translates every supplied model and issues the generated DDL
   * (`CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`) against the
   * database. Drizzle's own migration tooling remains the recommended production
   * path; this method mirrors the parity behaviour of the other decaf SQL adapters.
   * @template M The model type
   * @param {Array.<Constructor<M>>} models The models to create indexes for
   * @return {Promise<void>} Resolves when all statements have executed
   */
  async index<M extends Model>(
    ...models: Constructor<M>[]
  ): Promise<void> {
    for (const model of [SequenceModel, ...models] as Constructor<M>[]) {
      const statements = generateDDL(model, this.dialect);
      for (const statement of statements) {
        try {
          await this.executeRaw(sql.raw(statement));
        } catch (e: unknown) {
          // MySQL has no `CREATE INDEX IF NOT EXISTS`, so re-applying the
          // generated DDL raises a duplicate key name for existing indexes.
          // Treat that specific error as success to keep `index()` idempotent.
          if (this.dialect === "mysql" && isDuplicateIndexError(e)) continue;
          throw this.parseError(e as Error);
        }
      }
    }
  }

  /**
   * @description Inserts a record
   * @template M The model type
   * @param {Constructor<M>} clazz The model constructor
   * @param {PrimaryKeyType} id The primary key value
   * @param {Record<string, any>} model The prepared (db-keyed) record
   * @return {Promise<Record<string, any>>} The inserted record
   */
  override async create<M extends Model>(
    clazz: Constructor<M>,
    id: PrimaryKeyType,
    model: Record<string, any>,
    ...args: ContextualArgs<DrizzleContext>
  ): Promise<Record<string, any>> {
    void id;
    void args;
    const schema = this.schema(clazz);
    try {
      const values = this.toProperties(schema, model);
      await this.mutate(this.db.insert(schema.table).values(values));
      return model;
    } catch (e: unknown) {
      throw this.parseError(e as Error);
    }
  }

  /**
   * @description Reads a record by primary key
   * @template M The model type
   * @param {Constructor<M>} clazz The model constructor
   * @param {PrimaryKeyType} id The primary key value
   * @return {Promise<Record<string, any>>} The db-keyed record
   */
  override async read<M extends Model>(
    clazz: Constructor<M>,
    id: PrimaryKeyType,
    ...args: ContextualArgs<DrizzleContext>
  ): Promise<Record<string, any>> {
    void args;
    const schema = this.schema(clazz);
    const column = schema.table[schema.pk];
    const rows = await this.selectRows(
      this.db.select().from(schema.table).where(eq(column, id)).limit(1)
    );
    if (!rows || !rows.length)
      throw new NotFoundError(
        `Record ${id} not found in table ${schema.tableName}`
      );
    return this.toDbRecord(schema, rows[0]);
  }

  /**
   * @description Updates a record by primary key
   * @template M The model type
   * @param {Constructor<M>} clazz The model constructor
   * @param {PrimaryKeyType} id The primary key value
   * @param {Record<string, any>} model The prepared (db-keyed) record
   * @return {Promise<Record<string, any>>} The updated record
   */
  override async update<M extends Model>(
    clazz: Constructor<M>,
    id: PrimaryKeyType,
    model: Record<string, any>,
    ...args: ContextualArgs<DrizzleContext>
  ): Promise<Record<string, any>> {
    const schema = this.schema(clazz);
    const values = this.toProperties(schema, model);
    delete values[schema.pk];
    try {
      const column = schema.table[schema.pk];
      await this.mutate(
        this.db
          .update(schema.table)
          .set(values)
          .where(eq(column, id))
      );
    } catch (e: unknown) {
      throw this.parseError(e as Error);
    }
    return this.read(clazz, id, ...args);
  }

  /**
   * @description Deletes a record by primary key
   * @template M The model type
   * @param {Constructor<M>} clazz The model constructor
   * @param {PrimaryKeyType} id The primary key value
   * @return {Promise<Record<string, any>>} The deleted record
   */
  override async delete<M extends Model>(
    clazz: Constructor<M>,
    id: PrimaryKeyType,
    ...args: ContextualArgs<DrizzleContext>
  ): Promise<Record<string, any>> {
    const record = await this.read(clazz, id, ...args);
    const schema = this.schema(clazz);
    try {
      const column = schema.table[schema.pk];
      await this.mutate(
        this.db.delete(schema.table).where(eq(column, id))
      );
    } catch (e: unknown) {
      throw this.parseError(e as Error);
    }
    return record;
  }

  /**
   * @description Executes a raw Drizzle query
   * @summary Accepts a Drizzle `SQL` object or a raw SQL string, executes it
   * against the configured database and returns either the raw rows (when
   * `docsOnly` is true) or a `{ data, count }` envelope.
   * @template R The row type
   * @template D Whether only documents should be returned
   * @param {DrizzleQuery | string} rawInput The query
   * @param {D} docsOnly Whether to return only the rows
   * @return {Promise<RawResult<R, D>>} The query result
   */
  override async raw<R, D extends boolean>(
    rawInput: DrizzleQuery | string,
    docsOnly: D,
    ...args: ContextualArgs<DrizzleContext>
  ): Promise<RawResult<R, D>> {
    void args;
    const query =
      typeof rawInput === "string" ? sql.raw(rawInput) : rawInput;
    try {
      const rows = await this.selectRows(query);
      if (docsOnly) return rows as unknown as RawResult<R, D>;
      return { data: rows, count: rows.length } as RawResult<R, D>;
    } catch (e: unknown) {
      throw this.parseError(e as Error);
    }
  }

  /**
   * @description Parses a driver error into a decaf error
   * @param {Error} err The driver error
   * @return {Error} The normalised decaf error
   */
  override parseError<E extends BaseError>(err: Error, ...args: any[]): E {
    void args;
    return parseError(err) as E;
  }

  /**
   * @description Registers the Drizzle-flavoured model decorations
   * @summary Registers the ownership handlers (`createdBy`/`updatedBy`) and
   * overrides the `@date()` decoration with a SQL-safe timestamp format for
   * {@link DrizzleFlavour}. Must run before any model is decorated so the
   * flavour-specific overrides are in place when models resolve their pending
   * decorations.
   * @return {void}
   * @mermaid
   * sequenceDiagram
   *   participant A as DrizzleAdapter
   *   participant D as Decoration
   *   participant V as Validation
   *   A->>D: flavouredAs("drizzle")
   *   A->>D: for(createdBy)
   *   A->>D: define(onCreate(...), propMetadata)
   *   A->>D: apply()
   *   A->>D: for(updatedBy)
   *   A->>D: define(onCreateUpdate(...), propMetadata)
   *   A->>D: apply()
   *   A->>D: for(ValidationKeys.DATE)
   *   A->>D: define(sqlSafeDateDec)
   *   A->>D: apply()
   */
  static override decoration() {
    super.decoration();

    Decoration.flavouredAs(DrizzleFlavour)
      .for(PersistenceKeys.CREATED_BY)
      .define(
        onCreate(createdByOnDrizzleCreateUpdate),
        propMetadata(PersistenceKeys.CREATED_BY, {})
      )
      .apply();

    Decoration.flavouredAs(DrizzleFlavour)
      .for(PersistenceKeys.UPDATED_BY)
      .define(
        onCreateUpdate(createdByOnDrizzleCreateUpdate),
        propMetadata(PersistenceKeys.UPDATED_BY, {})
      )
      .apply();

    Decoration.flavouredAs(DrizzleFlavour)
      .for(ValidationKeys.DATE)
      .define({
        decorator: sqlSafeDateDec,
        args: [SQL_TIMESTAMP_FORMAT, DEFAULT_ERROR_MESSAGES.DATE],
      } as any)
      .apply();

    // `BaseModel` resolves its `@createdAt`/`@updatedAt` decorations under the
    // default flavour before the Drizzle flavour exists, so the flavoured `@date()`
    // override above cannot reach them. Without this, MySQL `DATETIME` columns
    // receive decaf's default `dd/MM/yyyy HH:mm:ss:S` format (the date instance
    // proxy makes `toISOString()` return that format) and reject the value on
    // insert/update. Re-register the base timestamps with the SQL-safe format so
    // every model inheriting `BaseModel` persists SQL-compatible dates.
    timestamp(DBOperations.CREATE, SQL_TIMESTAMP_FORMAT)(
      BaseModel.prototype,
      "createdAt"
    );
    timestamp(DBOperations.CREATE_UPDATE, SQL_TIMESTAMP_FORMAT)(
      BaseModel.prototype,
      "updatedAt"
    );
  }
}
