import { Constructor, Metadata } from "@decaf-ts/decoration";
import { Model, ValidationKeys } from "@decaf-ts/decorator-validation";
import {
  DBKeys,
  DBOperations,
  InternalError,
  Operations,
} from "@decaf-ts/db-decorators";
import {
  INDEX_SELF,
  IndexMetadata,
  PersistenceKeys,
  RelationsMetadata,
  SequenceOptions,
  uniqueOnCreateUpdate,
} from "@decaf-ts/core";
import {
  foreignKey as sqliteForeignKey,
  index as sqliteIndex,
  integer as sqliteInteger,
  primaryKey as sqlitePrimaryKey,
  sqliteTable,
  text as sqliteText,
  uniqueIndex as sqliteUniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  bigint as mysqlBigint,
  boolean as mysqlBoolean,
  datetime as mysqlDatetime,
  foreignKey as mysqlForeignKey,
  index as mysqlIndex,
  int as mysqlInt,
  json as mysqlJson,
  mysqlTable,
  primaryKey as mysqlPrimaryKey,
  text as mysqlText,
  uniqueIndex as mysqlUniqueIndex,
  varchar as mysqlVarchar,
} from "drizzle-orm/mysql-core";
import {
  bigint as pgBigint,
  boolean as pgBoolean,
  foreignKey as pgForeignKey,
  index as pgIndex,
  integer as pgInteger,
  jsonb as pgJsonb,
  pgTable,
  primaryKey as pgPrimaryKey,
  text as pgText,
  timestamp as pgTimestamp,
  uniqueIndex as pgUniqueIndex,
  varchar as pgVarchar,
} from "drizzle-orm/pg-core";
import {
  DrizzleFlavour,
  DrizzleKeys,
  DrizzleSeparator,
} from "../constants";
import { DrizzleDialect } from "../types";

/**
 * @description Property type as resolved from decaf decoration metadata
 * @summary The normalised, dialect-independent type name of a model property.
 * @typedef DrizzleColumnType
 * @memberOf module:for-drizzle
 */
export type DrizzleColumnType =
  | "string"
  | "number"
  | "bigint"
  | "boolean"
  | "date"
  | "object";

/**
 * @description Describes a translated column
 * @summary The physical database name plus the generated Drizzle column builder
 * and the metadata used to build table-level constraints.
 * @interface DrizzleColumnDefinition
 * @memberOf module:for-drizzle
 */
export interface DrizzleColumnDefinition {
  prop: string;
  dbName: string;
  type: DrizzleColumnType;
  builder: any;
  primaryKey: boolean;
  generated: boolean;
  required: boolean;
  unique: boolean;
  indexed: boolean;
  maxLength?: number;
  version: boolean;
  timestamp: boolean;
  relation?: {
    key: string;
    target: Constructor<Model>;
  };
}

/**
 * @description Result of translating a decaf model into a Drizzle schema
 * @summary Holds the generated Drizzle table, the mapping between model property
 * names and physical database column names, the primary key and the generated join
 * tables for many-to-many relations.
 * @interface DrizzleSchema
 * @memberOf module:for-drizzle
 */
export interface DrizzleSchema<M extends Model = Model> {
  dialect: DrizzleDialect;
  model: Constructor<M>;
  tableName: string;
  table: any;
  columns: Record<string, DrizzleColumnDefinition>;
  /** property name -> physical column name */
  columnNames: Record<string, string>;
  /** physical column name -> property name */
  propertyNames: Record<string, string>;
  pk: string;
  pkDbName: string;
  generatedPk: boolean;
  indexDefinitions: {
    name: string;
    /** model property names (and, for single-column indexes, the physical name) */
    columns: string[];
    /** physical column names */
    dbColumns: string[];
    unique: boolean;
  }[];
  foreignKeys: {
    /** model property holding the relation (and the generated FK column) */
    prop: string;
    /** physical column name of the FK column */
    dbName: string;
    /** decorated constructor of the referenced model */
    target: Constructor<Model>;
    /** physical table name of the referenced model */
    targetTableName: string;
    /** model property name of the referenced primary key */
    targetPk: string;
    /** physical column name of the referenced primary key */
    targetPkDbName: string;
    onDelete: string;
    onUpdate: string;
  }[];
  joinTables: Record<string, any>;
}

/**
 * @description Cache of generated Drizzle schemas
 * @summary Keyed by the model constructor and then by dialect, so repeated
 * lookups reuse the same table objects (Drizzle tables are identity-sensitive)
 * without two distinct classes that share a `name` colliding.
 */
let schemaCache = new WeakMap<
  Constructor<any>,
  Map<DrizzleDialect, DrizzleSchema<any>>
>();

/**
 * @description Validates a physical SQL identifier
 * @summary Generated DDL is executed through `sql.raw`, so a decorated table,
 * column or index name must be a plain identifier; anything else is rejected
 * before the DDL is built. The framework-owned `??` prefix is allowed (it is
 * rejected at write time by `isReserved`) and validated on the name that follows.
 * @param {string} identifier The physical identifier to validate
 * @param {string} kind The identifier kind, used in the error message
 * @return {void}
 * @throws {InternalError} When the identifier is not a plain SQL identifier
 */
function assertValidIdentifier(identifier: string, kind: string): void {
  const candidate =
    typeof identifier === "string" ? identifier.replace(/^\?\?/, "") : identifier;
  if (
    typeof candidate !== "string" ||
    !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(candidate)
  )
    throw new InternalError(
      `Invalid ${kind} identifier "${String(
        identifier
      )}": only [A-Za-z_][A-Za-z0-9_$]* is allowed`
    );
}

/**
 * @description Normalises a raw design type into a {@link DrizzleColumnType}
 * @summary Resolves the property type from the decoration metadata, handling
 * constructor functions, string type names and model-valued relations.
 * @param {any} type The raw metadata type
 * @return {DrizzleColumnType} The normalised type
 * @function resolveColumnType
 * @memberOf module:for-drizzle
 */
export function resolveColumnType(type: any): DrizzleColumnType {
  const candidate =
    typeof type === "function" && (type as any).name
      ? (type as any).name
      : type;
  if (typeof candidate !== "string") return "object";
  switch (candidate.toLowerCase()) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "bigint":
      return "bigint";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    default:
      return "object";
  }
}

/**
 * @description Collects every property declared on a model and its ancestors
 * @summary `Metadata.properties` only reports the properties registered against
 * the exact constructor, so the prototype chain is walked to include inherited
 * properties (such as the timestamps contributed by `BaseModel`).
 * @template M The model type
 * @param {Constructor<M>} model The decaf model
 * @return {string[]} The deduplicated property names
 * @function collectProperties
 * @memberOf module:for-drizzle
 */
export function collectProperties<M extends Model>(
  model: Constructor<M>
): string[] {
  const props = new Set<string>();
  let current: any = model;
  while (
    typeof current === "function" &&
    current !== Function &&
    current !== Object
  ) {
    const own = Metadata.properties(current);
    if (own) own.forEach((prop) => props.add(prop));
    current = Object.getPrototypeOf(current);
  }
  return [...props];
}

/**
 * @description Resolves the column type of a model property
 * @summary Reads the design/metadata type and normalises it to a
 * {@link DrizzleColumnType}. Model-valued relations inherit the SQL type of the
 * referenced primary key (MySQL rejects a foreign key whose column type differs
 * from the referenced column) and ambiguous scalar `Object` design types fall
 * back to a text column unless serialisation metadata marks them as JSON.
 * @template M The model type
 * @param {Constructor<M>} model The decaf model
 * @param {string} prop The property name
 * @return {DrizzleColumnType} The normalised column type
 */
function propertyType<M extends Model>(
  model: Constructor<M>,
  prop: string
): DrizzleColumnType {
  let metaType: any;
  try {
    metaType = Metadata.type(model, prop);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    metaType = undefined;
  }
  if (!metaType) {
    try {
      metaType = Metadata.getPropDesignTypes(model as any, prop)?.designType;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e: unknown) {
      metaType = undefined;
    }
  }
  const resolved = resolveColumnType(metaType);
  if (resolved !== "object") return resolved;
  const relation = relationFor(model, prop);
  if (relation) {
    // A relation column stores the target primary key, so its SQL type must mirror
    // the referenced column. MySQL rejects a foreign key whose column type differs
    // from the referenced one (for example `JSON` -> `INT`).
    const targetPk = Model.pk(relation.target) as string;
    if (targetPk && targetPk !== prop) {
      const targetType = propertyType(relation.target, targetPk);
      if (targetType !== "object") return targetType;
    }
    return "object";
  }
  // A structured JSON column is produced for arrays, model-valued relations and
  // explicitly serialised (`@serialize()`) properties. A bare `Object` design type
  // without either is an ambiguous scalar (for example the `string | number` union
  // on `SequenceModel.current`) and must stay a text column so it remains
  // indexable on MySQL.
  if (metaType !== Object && typeof metaType !== "undefined") return "object";
  if (metaFor(model, DBKeys.SERIALIZE, prop)) return "object";
  return "string";
}

/**
 * @description Reads per-property metadata with fallbacks
 * @summary Tries `Metadata.validationFor` first and falls back to the flat
 * `Metadata.get` key so decorations registered in either shape are found.
 * @template M The model type
 * @param {Constructor<M>} model The decaf model
 * @param {string} key The metadata key to resolve
 * @param {string} prop The property name
 * @return {any} The metadata value, or `undefined` when absent
 */
function metaFor<M extends Model>(
  model: Constructor<M>,
  key: string,
  prop: string
): any {
  try {
    const validation = Metadata.validationFor(model as any, prop as any, key);
    if (typeof validation !== "undefined") return validation;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    // fall through to the flat metadata reader below
  }
  try {
    return Metadata.get(model, Metadata.key(key, prop));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    return undefined;
  }
}

/**
 * @description Checks whether a property is required
 * @summary Resolves the `@required()` validation metadata.
 * @template M The model type
 * @param {Constructor<M>} model The decaf model
 * @param {string} prop The property name
 * @return {boolean} True when the property is decorated `@required()`
 */
function isRequired<M extends Model>(
  model: Constructor<M>,
  prop: string
): boolean {
  return !!metaFor(model, ValidationKeys.REQUIRED, prop);
}

/**
 * @description Resolves the declared maximum length of a string property
 * @summary Reads the `@maxlength()` validation metadata and normalises the
 * historical `maxlength` alias.
 * @template M The model type
 * @param {Constructor<M>} model The decaf model
 * @param {string} prop The property name
 * @return {number | undefined} The maximum length, or `undefined` when unbounded
 */
function maxLength<M extends Model>(
  model: Constructor<M>,
  prop: string
): number | undefined {
  const meta = metaFor(model, ValidationKeys.MAX_LENGTH, prop);
  if (!meta) return undefined;
  const value =
    (meta as any)[ValidationKeys.MAX_LENGTH] ?? (meta as any).maxlength;
  return typeof value === "number" ? value : undefined;
}

/**
 * @description Checks whether a property carries a unique constraint
 * @summary Accepts both the `@unique()` metadata marker and the
 * `uniqueOnCreateUpdate` operation handler that decaf registers per property.
 * @template M The model type
 * @param {Constructor<M>} model The decaf model
 * @param {string} prop The property name
 * @return {boolean} True when the property is unique
 */
function isUnique<M extends Model>(
  model: Constructor<M>,
  prop: string
): boolean {
  if (metaFor(model, PersistenceKeys.UNIQUE, prop)) return true;
  // decaf's `@unique` decorator records a class-level marker and attaches the
  // `uniqueOnCreateUpdate` operation handler to the decorated property instead of
  // per-property validation metadata, so the handler registry is the only reliable
  // per-property signal for a unique constraint.
  const uniqueHandler = Operations.getHandlerName(uniqueOnCreateUpdate);
  for (const op of DBOperations.CREATE_UPDATE) {
    let handlers: any[] | undefined;
    try {
      handlers = Operations.get(model.name, prop, `on.${op}`);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e: unknown) {
      handlers = undefined;
    }
    if (
      handlers?.some(
        (handler) => Operations.getHandlerName(handler) === uniqueHandler
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * @description Checks whether a property is version-tracked
 * @summary Resolves the `@version()` metadata.
 * @template M The model type
 * @param {Constructor<M>} model The decaf model
 * @param {string} prop The property name
 * @return {boolean} True when the property is a version column
 */
function isVersion<M extends Model>(
  model: Constructor<M>,
  prop: string
): boolean {
  return !!metaFor(model, DBKeys.VERSION, prop);
}

/**
 * @description Checks whether a property is a managed timestamp
 * @summary Resolves the `@createdAt()`/`@updatedAt()` timestamp metadata.
 * @template M The model type
 * @param {Constructor<M>} model The decaf model
 * @param {string} prop The property name
 * @return {boolean} True when the property is a framework-managed timestamp
 */
function isTimestamp<M extends Model>(
  model: Constructor<M>,
  prop: string
): boolean {
  return !!metaFor(model, DBKeys.TIMESTAMP, prop);
}

/**
 * @description Checks whether a property is generated
 * @summary Resolves the `@generated()` metadata or the sequence option
 * (`Model.sequenceFor`) marking the value as produced by the framework.
 * @template M The model type
 * @param {Constructor<M>} model The decaf model
 * @param {string} prop The property name
 * @return {boolean} True when the property value is framework-generated
 */
function isGenerated<M extends Model>(
  model: Constructor<M>,
  prop: string
): boolean {
  const generated = metaFor(model, DBKeys.GENERATED, prop);
  if (generated) return true;
  try {
    const seq: SequenceOptions = Model.sequenceFor(model, prop as any);
    return !!seq?.generated;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    return false;
  }
}

/**
 * @description Resolves the relation metadata of a property
 * @summary Reads `PersistenceKeys.RELATIONS` for the property and resolves the
 * decorated target constructor (allowing lazy `() => Model` definitions).
 * @template M The model type
 * @param {Constructor<M>} model The decaf model
 * @param {string} prop The property name
 * @return {Object | undefined} The relation descriptor (with `key` and `target`),
 * or `undefined` when the property is not a relation
 */
function relationFor<M extends Model>(
  model: Constructor<M>,
  prop: string
): { key: string; target: Constructor<Model> } | undefined {
  let relations: Record<string, any> | undefined;
  try {
    relations = Metadata.get(model, PersistenceKeys.RELATIONS) as Record<
      string,
      any
    >;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    relations = undefined;
  }
  if (!relations || !relations[prop]) return undefined;
  const meta = relations[prop] as RelationsMetadata & { key: string };
  let target: any = meta.class;
  if (typeof target === "function" && !(target as any).name) target = target();
  if (!target) return undefined;
  const resolved = Metadata.constr(target as Constructor<any>);
  return { key: meta.key, target: resolved as Constructor<Model> };
}

/**
 * @description Builds a Drizzle column builder for a given dialect and type
 * @summary Maps a decaf property type to the dialect-specific Drizzle column
 * builder, applying `notNull`, `unique`, `primaryKey` and `autoIncrement` where
 * appropriate.
 * @param {DrizzleDialect} dialect The target dialect
 * @param {string} dbName The physical column name
 * @param {DrizzleColumnType} type The normalised decaf property type
 * @param {object} options Column options
 * @return {any} The Drizzle column builder
 * @function buildColumn
 * @memberOf module:for-drizzle
 */
export function buildColumn(
  dialect: DrizzleDialect,
  dbName: string,
  type: DrizzleColumnType,
  options: {
    primaryKey: boolean;
    generated: boolean;
    required: boolean;
    unique: boolean;
    indexed?: boolean;
    maxLength?: number;
  }
): any {
  const { primaryKey, generated, required, unique, maxLength } = options;
  const indexed = options.indexed ?? false;
  let builder: any;
  if (dialect === "sqlite") {
    switch (type) {
      case "number":
        builder = sqliteInteger(dbName);
        break;
      case "bigint":
        builder = sqliteInteger(dbName);
        break;
      case "boolean":
        builder = sqliteInteger(dbName, { mode: "boolean" });
        break;
      case "date":
        builder = sqliteInteger(dbName, { mode: "timestamp_ms" });
        break;
      case "string":
      case "object":
      default:
        builder = sqliteText(dbName, {
          length: maxLength as any,
        });
        break;
    }
    if (required || primaryKey) builder = builder.notNull();
    if (unique) builder = builder.unique();
    if (primaryKey) {
      builder = generated
        ? builder.primaryKey({ autoIncrement: type === "number" })
        : builder.primaryKey();
    }
    return builder;
  }

  if (dialect === "postgres") {
    switch (type) {
      case "number":
        builder = pgInteger(dbName);
        break;
      case "bigint":
        builder = pgBigint(dbName, { mode: "bigint" });
        break;
      case "boolean":
        builder = pgBoolean(dbName);
        break;
      case "date":
        builder = pgTimestamp(dbName);
        break;
      case "object":
        builder = pgJsonb(dbName);
        break;
      case "string":
      default:
        // PostgreSQL `TEXT` is unbounded and can be indexed/unique directly, so
        // only an explicit `@maxlength` narrows the column to `VARCHAR`.
        builder =
          typeof maxLength === "number"
            ? pgVarchar(dbName, {
                length: Math.min(maxLength, 10485760),
              })
            : pgText(dbName);
        break;
    }
    if (required || primaryKey) builder = builder.notNull();
    if (unique) builder = builder.unique();
    if (primaryKey) builder = builder.primaryKey();
    return builder;
  }

  // mysql
  switch (type) {
    case "number":
      builder = mysqlInt(dbName);
      break;
    case "bigint":
      builder = mysqlBigint(dbName, { mode: "bigint" });
      break;
    case "boolean":
      builder = mysqlBoolean(dbName);
      break;
    case "date":
      builder = mysqlDatetime(dbName);
      break;
    case "object":
      builder = mysqlJson(dbName);
      break;
    case "string":
    default:
      // An explicit `@maxlength` is always honoured. Otherwise a string with no
      // bounded key role (primary key, unique or indexed) maps to MySQL `TEXT` so
      // values are not silently truncated at the historical `VARCHAR(255)`
      // default. Columns that participate in a MySQL key must stay bounded:
      // `TEXT` cannot be indexed/unique without a prefix length and can never be
      // a primary key, and Drizzle's table builders cannot express key prefixes.
      builder =
        typeof maxLength === "number"
          ? mysqlVarchar(dbName, {
              length: Math.min(maxLength, 65535),
            })
          : primaryKey || unique || indexed
            ? mysqlVarchar(dbName, {
                length: DrizzleKeys.DEFAULT_STRING_LENGTH,
              })
            : mysqlText(dbName);
      break;
  }
  if (required || primaryKey) builder = builder.notNull();
  if (unique) builder = builder.unique();
  if (primaryKey) {
    builder = builder.primaryKey();
    if (generated && type === "number") builder = builder.autoincrement();
  }
  return builder;
}

/**
 * @description Composes a deterministic index name
 * @summary Joins the table name, indexed columns, optional sort direction and the
 * index suffix with {@link DrizzleSeparator}.
 * @param {string} tableName The physical table name
 * @param {string[]} columns The physical column names
 * @param {string} [direction] Optional sort direction segment
 * @return {string} The generated index name
 */
function indexName(
  tableName: string,
  columns: string[],
  direction?: string
): string {
  return [
    tableName,
    ...columns,
    ...(direction ? [direction] : []),
    DrizzleKeys.INDEX_SUFFIX,
  ].join(DrizzleSeparator);
}

/**
 * @description Collects the model properties that participate in any index
 * @summary Walks `Model.indexes` and gathers both the indexed attribute and every
 * composition property so a column can tell whether it must remain a bounded MySQL
 * key column.
 * @template M The model type
 * @param {Constructor<M>} model The decaf model
 * @return {Set<string>} The indexed model property names
 * @function indexedProperties
 * @memberOf module:for-drizzle
 */
function indexedProperties<M extends Model>(
  model: Constructor<M>
): Set<string> {
  const props = new Set<string>();
  let raw: Record<string, Record<string, IndexMetadata>>;
  try {
    raw = Model.indexes(model) as Record<string, Record<string, IndexMetadata>>;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    raw = {};
  }
  for (const attr of Object.keys(raw || {})) {
    props.add(attr);
    const variants = raw[attr] || {};
    for (const variant of Object.keys(variants)) {
      const meta = variants[variant] as IndexMetadata;
      ((meta?.compositions || []) as string[]).forEach((c) => props.add(c));
    }
  }
  return props;
}

/**
 * @description Collects the index definitions declared on a model
 * @summary Walks `Model.indexes`, resolves the physical column names (including
 * compositions) and the index name. Single-column indexes additionally expose
 * their physical column names; composite indexes stay keyed by property names.
 * @template M The model type
 * @param {Constructor<M>} model The decaf model
 * @param {string} tableName The physical table name
 * @param {DrizzleDialect} dialect The target dialect
 * @param {Record<string, DrizzleColumnDefinition>} columns The translated columns
 * @return {Object[]} The index definitions, each with `name`, `columns`,
 * `dbColumns` and `unique`
 */
function buildIndexes<M extends Model>(
  model: Constructor<M>,
  tableName: string,
  dialect: DrizzleDialect,
  columns: Record<string, DrizzleColumnDefinition>
): {
  name: string;
  columns: string[];
  dbColumns: string[];
  unique: boolean;
}[] {
  const result: {
    name: string;
    columns: string[];
    dbColumns: string[];
    unique: boolean;
  }[] = [];
  let raw: Record<string, Record<string, IndexMetadata>>;
  try {
    raw = Model.indexes(model) as Record<string, Record<string, IndexMetadata>>;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    raw = {};
  }
  for (const attr of Object.keys(raw || {})) {
    const variants = raw[attr] || {};
    for (const variant of Object.keys(variants)) {
      const meta = variants[variant] as IndexMetadata;
      const compositions = (meta?.compositions || []) as string[];
      const cols = [attr, ...compositions].filter((c) => c in columns);
      if (!cols.length) continue;
      const dbCols = cols.map((c) => columns[c].dbName);
      dbCols.forEach((c) => assertValidIdentifier(c, "index column"));
      const directions = meta?.directions;
      const direction = directions?.length ? String(directions[0]) : undefined;
      const name = meta?.name || indexName(tableName, dbCols, direction);
      assertValidIdentifier(name, "index");
      // Composite indexes stay keyed by model property name (the generator
      // resolves the physical names); single-column indexes additionally expose
      // their physical name so index definitions carry the physical column.
      const exposed = compositions.length
        ? cols
        : [...new Set([...cols, ...dbCols])];
      result.push({ name, columns: exposed, dbColumns: dbCols, unique: false });
      if (variant !== INDEX_SELF && variant) {
        // composite variant already covered by the composed index above
        void variant;
      }
    }
  }
  void dialect;
  return result;
}

/**
 * @description Resolves the relation constraints of a model
 * @summary For `@oneToOne`/`@manyToOne` relations, emits (or reuses) the foreign-key
 * column and records the constraint descriptor; for `@manyToMany` relations,
 * records the join-table descriptor; `@oneToMany` is inverse-only and yields nothing.
 * @template M The model type
 * @param {Constructor<M>} model The decaf model
 * @param {DrizzleDialect} dialect The target dialect
 * @param {Record<string, DrizzleColumnDefinition>} columns The translated columns
 * @param {string} tableName The physical table name
 * @return {Object} An object with the `foreignKeys` and `joinTables` descriptors
 */
function buildRelations<M extends Model>(
  model: Constructor<M>,
  dialect: DrizzleDialect,
  columns: Record<string, DrizzleColumnDefinition>,
  tableName: string
): {
  foreignKeys: any[];
  joinTables: Record<string, any>;
} {
  let relations: Record<string, any> | undefined;
  try {
    relations = Metadata.get(model, PersistenceKeys.RELATIONS) as Record<
      string,
      any
    >;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e: unknown) {
    relations = undefined;
  }
  const foreignKeys: any[] = [];
  const joinTables: Record<string, any> = {};
  if (!relations) return { foreignKeys, joinTables };

  for (const prop of Object.keys(relations)) {
    const meta = relations[prop] as RelationsMetadata & { key: string };
    if (!meta || !meta.key) continue;
    let target: any = meta.class;
    if (typeof target === "function" && !(target as any).name) target = target();
    if (!target) continue;
    const targetConstr = Metadata.constr(target as Constructor<any>);
    const targetTableName = Model.tableName(targetConstr).replace(
      /^\?\?/,
      `${DrizzleFlavour}${DrizzleSeparator}`
    );
    assertValidIdentifier(targetTableName, "table");
    const targetPk = Model.pk(targetConstr) as string;
    const targetPkDbName = Model.columnName(targetConstr, targetPk as any);
    assertValidIdentifier(targetPkDbName, "column");
    const onDelete = meta.cascade?.delete ? "cascade" : "no action";
    const onUpdate = meta.cascade?.update ? "cascade" : "no action";

    switch (meta.key) {
      case PersistenceKeys.ONE_TO_ONE:
      case PersistenceKeys.MANY_TO_ONE: {
        if (!columns[prop]) {
          // The FK column is not part of the model properties; generate one.
          // Mirror the target primary-key type so the FK column matches the
          // referenced column on MySQL.
          const fkType = propertyType(targetConstr, targetPk);
          columns[prop] = {
            prop,
            dbName: prop,
            type: fkType,
            builder: buildColumn(dialect, prop, fkType, {
              primaryKey: false,
              generated: false,
              required: false,
              unique: false,
            }),
            primaryKey: false,
            generated: false,
            required: false,
            unique: false,
            indexed: false,
            version: false,
            timestamp: false,
            relation: { key: meta.key, target: targetConstr },
          };
        }
        foreignKeys.push({
          prop,
          dbName: columns[prop].dbName,
          target: targetConstr,
          targetTableName,
          targetPk,
          targetPkDbName,
          onDelete,
          onUpdate,
        });
        break;
      }
      case PersistenceKeys.MANY_TO_MANY: {
        const joinName = `${tableName}${DrizzleSeparator}${prop}${DrizzleSeparator}join`;
        assertValidIdentifier(joinName, "join table");
        joinTables[prop] = {
          name: joinName,
          sourceTableName: tableName,
          sourcePkDbName: columns[Model.pk(model) as string]?.dbName ?? "id",
          targetTableName,
          targetPkDbName,
        };
        break;
      }
      case PersistenceKeys.ONE_TO_MANY:
        // The FK is materialised on the child model's many-to-one side.
        break;
      default:
        break;
    }
  }
  void dialect;
  return { foreignKeys, joinTables };
}

/**
 * @description Translates decaf model decoration metadata into a Drizzle table
 * @summary Reads table/column/identity/unique/version/index/relation metadata
 * from a decaf model and produces the equivalent dialect-specific Drizzle table
 * definition. The generated schema is cached per model and dialect so Drizzle table
 * identity remains stable across calls.
 * @template M The model type
 * @param {Constructor<M>} model The decaf model constructor
 * @param {DrizzleDialect} dialect The target SQL dialect
 * @return {DrizzleSchema<M>} The translated schema
 * @function translateModel
 * @memberOf module:for-drizzle
 */
export function translateModel<M extends Model>(
  model: Constructor<M>,
  dialect: DrizzleDialect
): DrizzleSchema<M> {
  let dialects = schemaCache.get(model);
  if (!dialects) {
    dialects = new Map<DrizzleDialect, DrizzleSchema<any>>();
    schemaCache.set(model, dialects);
  }
  const cached = dialects.get(dialect);
  if (cached) return cached as DrizzleSchema<M>;

  // decaf reserves the "??" prefix for framework-owned tables (e.g. the
  // sequence model). The adapter substitutes its own flavour so the resulting
  // physical name is a valid, namespaced identifier.
  const tableName = Model.tableName(model).replace(
    /^\?\?/,
    `${DrizzleFlavour}${DrizzleSeparator}`
  );
  assertValidIdentifier(tableName, "table");
  const pk = Model.pk(model) as string;
  const props = collectProperties(model);
  const indexedProps = indexedProperties(model);
  const columns: Record<string, DrizzleColumnDefinition> = {};

  for (const prop of props) {
    const relation = relationFor(model, prop);
    // `@oneToMany` is the inverse side of a relation: the foreign key is
    // materialised on the owning `@manyToOne`/`@oneToOne` side, so no physical
    // column is emitted for it (README: "@oneToMany ... no extra column").
    if (relation?.key === PersistenceKeys.ONE_TO_MANY) continue;
    const dbName = Model.columnName(model, prop as any);
    assertValidIdentifier(dbName, "column");
    const type = propertyType(model, prop);
    const primaryKey = prop === pk;
    const indexed = indexedProps.has(prop);
    const generated = isGenerated(model, prop);
    // Framework-managed (`@generated`) columns (e.g. `@createdAt`/`@updatedAt`,
    // `@version`) are populated by the repository/decorators, not by the caller,
    // so they must not be `NOT NULL`: a direct adapter insert (or a caller that
    // omits them) would otherwise fail on the database constraint.
    const required = isRequired(model, prop) && !generated;
    const unique = isUnique(model, prop) || primaryKey;
    const version = isVersion(model, prop);
    const timestamp = isTimestamp(model, prop);
    const max = maxLength(model, prop);
    columns[prop] = {
      prop,
      dbName,
      type,
      builder: buildColumn(dialect, dbName, type, {
        primaryKey,
        generated,
        required,
        unique,
        indexed,
        maxLength: max,
      }),
      primaryKey,
      generated,
      required,
      unique,
      indexed,
      version,
      timestamp,
      maxLength: max,
      relation,
    };
  }

  const columnNames: Record<string, string> = {};
  const propertyNames: Record<string, string> = {};
  for (const prop of Object.keys(columns)) {
    columnNames[prop] = columns[prop].dbName;
    propertyNames[columns[prop].dbName] = prop;
  }

  const tableBuilder: any =
    dialect === "sqlite" ? sqliteTable : dialect === "mysql" ? mysqlTable : pgTable;
  const indexBuilder: any =
    dialect === "sqlite" ? sqliteIndex : dialect === "mysql" ? mysqlIndex : pgIndex;
  const uniqueIndexBuilder: any =
    dialect === "sqlite"
      ? sqliteUniqueIndex
      : dialect === "mysql"
        ? mysqlUniqueIndex
        : pgUniqueIndex;
  const foreignKeyBuilder: any =
    dialect === "sqlite"
      ? sqliteForeignKey
      : dialect === "mysql"
        ? mysqlForeignKey
        : pgForeignKey;

  const extras: any[] = [];
  const indexDefs = buildIndexes(model, tableName, dialect, columns);
  // `pg-core` resolves index/foreign-key columns eagerly and does not accept the
  // table-callback form used by `sqlite-core`/`mysql-core`, so PostgreSQL indexes
  // are built inside the table callback where the real columns are available.
  const buildPgIndexExtras = (self: any): any[] =>
    indexDefs.map((def) => {
      const builder = def.unique ? uniqueIndexBuilder : indexBuilder;
      return builder(def.name).on(
        ...def.dbColumns.map((c) => self[propertyNames[c] ?? c])
      );
    });
  if (dialect !== "postgres") {
    for (const def of indexDefs) {
      const builder = def.unique ? uniqueIndexBuilder : indexBuilder;
      extras.push(
        builder(def.name).on(
          ...def.dbColumns.map(
            (c) => (self: any) => self[propertyNames[c] ?? c]
          )
        )
      );
    }
  }

  const { foreignKeys, joinTables } = buildRelations(
    model,
    dialect,
    columns,
    tableName
  );
  if (dialect !== "postgres") {
    for (const fk of foreignKeys) {
      // `sqliteTable`/`mysqlTable` require the extra-config callback form;
      // passing a raw array throws when Drizzle's `getTableConfig` resolves it.
      // The referenced column is resolved lazily so cyclic relations cannot
      // recurse while the table is being built.
      extras.push((self: any) =>
        foreignKeyBuilder(() => ({
          columns: [self[fk.prop]],
          foreignColumns: [
            translateModel(fk.target, dialect).table[fk.targetPk],
          ],
        }))
      );
    }
  }

  const columnBuilders = Object.fromEntries(
    Object.entries(columns).map(([prop, def]) => [prop, def.builder])
  );
  const table =
    dialect === "postgres"
      ? tableBuilder(tableName, columnBuilders, (self: any) =>
          buildPgIndexExtras(self)
        )
      : tableBuilder(
          tableName,
          columnBuilders,
          extras.length ? extras : undefined
        );

  const schema: DrizzleSchema<M> = {
    dialect,
    model,
    tableName,
    table,
    columns,
    columnNames,
    propertyNames,
    pk,
    pkDbName: columns[pk]?.dbName ?? pk,
    generatedPk: columns[pk]?.generated ?? false,
    indexDefinitions: indexDefs,
    foreignKeys,
    joinTables: Object.fromEntries(
      Object.entries(joinTables).map(([prop, def]) => [
        prop,
        buildJoinTable(dialect, def as any),
      ])
    ),
  };

  dialects.set(dialect, schema);
  return schema;
}

/**
 * @description Builds a Drizzle join table for a many-to-many relation
 * @summary Creates the `(source_id, target_id)` table with a composite primary
 * key and foreign keys to both parent tables, using the dialect-specific builders.
 * @param {DrizzleDialect} dialect The target dialect
 * @param {object} def The join-table descriptor
 * @return {any} The Drizzle join table
 */
function buildJoinTable(
  dialect: DrizzleDialect,
  def: {
    name: string;
    sourceTableName: string;
    sourcePkDbName: string;
    targetTableName: string;
    targetPkDbName: string;
  }
): any {
  const columnBuilder: any =
    dialect === "sqlite" ? sqliteInteger : dialect === "mysql" ? mysqlInt : pgInteger;
  const tableFn: any =
    dialect === "sqlite" ? sqliteTable : dialect === "mysql" ? mysqlTable : pgTable;
  const pkFn: any =
    dialect === "sqlite"
      ? sqlitePrimaryKey
      : dialect === "mysql"
        ? mysqlPrimaryKey
        : pgPrimaryKey;
  const fkFn: any =
    dialect === "sqlite"
      ? sqliteForeignKey
      : dialect === "mysql"
        ? mysqlForeignKey
        : pgForeignKey;
  const table = tableFn(def.name, {
    sourceId: columnBuilder("source_id").notNull(),
    targetId: columnBuilder("target_id").notNull(),
  }, (self: any) => [
    pkFn({ columns: [self.sourceId, self.targetId] }),
    fkFn({
      columns: [self.sourceId],
      foreignColumns: [self.sourcePkDbName],
    }),
    fkFn({
      columns: [self.targetId],
      foreignColumns: [self.targetPkDbName],
    }),
  ]);
  return table;
}

/**
 * @description Clears the generated schema cache
 * @summary Intended for tests that need to rebuild schemas after model
 * decoration changes.
 * @function clearSchemaCache
 * @memberOf module:for-drizzle
 */
export function clearSchemaCache(): void {
  schemaCache = new WeakMap();
}
