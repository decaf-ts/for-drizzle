import { Model } from "@decaf-ts/decorator-validation";
import { Constructor } from "@decaf-ts/decoration";
import { getTableName } from "drizzle-orm";
import {
  DrizzleSchema,
  DrizzleColumnType,
  translateModel,
} from "../schema/translation";
import { DrizzleDialect } from "../types";

/**
 * @description Quotes a SQL identifier for the dialect
 * @summary MySQL uses backticks; SQLite and PostgreSQL use double quotes. Any
 * embedded quote character is doubled (the SQL escape for a quoted identifier) so a
 * crafted table/column/index name cannot terminate the identifier and inject DDL.
 * @param {DrizzleDialect} dialect The target dialect
 * @param {string} name The identifier to quote
 * @return {string} The quoted identifier
 */
function quoteIdentifier(dialect: DrizzleDialect, name: string): string {
  return dialect === "mysql"
    ? `\`${name.replace(/`/g, "``")}\``
    : `"${name.replace(/"/g, '""')}"`;
}

/**
 * @description Maps a column type to its SQLite DDL type
 * @summary Numeric/boolean/date types map to `INTEGER`, everything else to `TEXT`.
 * @param {DrizzleColumnType} type The normalised column type
 * @return {string} The SQLite type name
 */
function sqliteType(type: DrizzleColumnType): string {
  switch (type) {
    case "number":
    case "bigint":
    case "boolean":
    case "date":
      return "INTEGER";
    case "string":
    case "object":
    default:
      return "TEXT";
  }
}

/**
 * @description Maps a column type to its PostgreSQL DDL type
 * @summary `JSONB` for structured values, `TIMESTAMP` for dates and `VARCHAR`
 * (bounded) or `TEXT` for strings; key-participating unbounded strings narrow to
 * `VARCHAR(255)` so they remain indexable.
 * @param {DrizzleColumnType} type The normalised column type
 * @param {number} [maxLength] Declared `@maxlength` of the property
 * @param {boolean} [bounded] True when the column participates in a key
 * @return {string} The PostgreSQL type name
 */
function postgresType(
  type: DrizzleColumnType,
  maxLength?: number,
  bounded = false
): string {
  switch (type) {
    case "number":
      return "INTEGER";
    case "bigint":
      return "BIGINT";
    case "boolean":
      return "BOOLEAN";
    case "date":
      return "TIMESTAMP";
    case "object":
      return "JSONB";
    case "string":
      if (typeof maxLength === "number")
        return `VARCHAR(${Math.min(maxLength, 10485760)})`;
      return bounded ? "VARCHAR(255)" : "TEXT";
    default:
      return "TEXT";
  }
}

/**
 * @description Maps a column type to its MySQL DDL type
 * @summary `JSON` for structured values, `DATETIME(3)` for dates and `VARCHAR`
 * (bounded) or `TEXT` for strings; key-participating unbounded strings narrow to
 * `VARCHAR(255)` because `TEXT` cannot be indexed or used as a primary key.
 * @param {DrizzleColumnType} type The normalised column type
 * @param {number} [maxLength] Declared `@maxlength` of the property
 * @param {boolean} [bounded] True when the column participates in a key
 * @return {string} The MySQL type name
 */
function mysqlType(
  type: DrizzleColumnType,
  maxLength?: number,
  bounded = false
): string {
  switch (type) {
    case "number":
      return "INT";
    case "bigint":
      return "BIGINT";
    case "boolean":
      return "TINYINT(1)";
    case "date":
      return "DATETIME(3)";
    case "object":
      return "JSON";
    case "string":
      if (typeof maxLength === "number")
        return `VARCHAR(${Math.min(maxLength, 65535)})`;
      return bounded ? "VARCHAR(255)" : "TEXT";
    default:
      return "TEXT";
  }
}

/**
 * @description Builds a `CREATE TABLE` statement for a translated schema
 * @summary Emits a dialect-specific `CREATE TABLE IF NOT EXISTS` statement from a
 * decaf model's translated schema, including primary key, nullability and unique
 * column constraints.
 * @param {DrizzleSchema} schema The translated schema
 * @return {string} The DDL statement
 * @function createTableSQL
 * @memberOf module:for-drizzle
 */
export function createTableSQL(schema: DrizzleSchema): string {
  const { dialect } = schema;
  const indexedColumns = new Set<string>();
  for (const index of schema.indexDefinitions || []) {
    const physical = index.dbColumns?.length
      ? index.dbColumns
      : index.columns.map((c) => schema.columns[c]?.dbName ?? c);
    physical.forEach((c) => indexedColumns.add(c));
  }
  const columns = Object.values(schema.columns).map((def: any) => {
    const name = quoteIdentifier(dialect, def.dbName);
    const bounded =
      !!def.primaryKey || !!def.unique || !!def.indexed ||
      indexedColumns.has(def.dbName);
    const type =
      dialect === "mysql"
        ? mysqlType(def.type, def.maxLength, bounded)
        : dialect === "postgres"
          ? postgresType(def.type, def.maxLength, bounded)
          : sqliteType(def.type);
    const generatedNumericPk =
      def.generated && (def.type === "number" || def.type === "bigint");
    const parts = [name, type];
    // PostgreSQL has no inline `AUTO_INCREMENT`; an identity column lets raw
    // inserts (and migration SQL) omit the primary key while still accepting the
    // sequence-generated values decaf supplies for repository creates.
    if (dialect === "postgres" && generatedNumericPk)
      parts.push("GENERATED BY DEFAULT AS IDENTITY");
    if (def.primaryKey) {
      parts.push("PRIMARY KEY");
      if (generatedNumericPk) {
        if (dialect === "mysql") parts.push("AUTO_INCREMENT");
        else if (dialect === "sqlite") parts.push("AUTOINCREMENT");
      }
    }
    if (def.required && !def.primaryKey) parts.push("NOT NULL");
    if (def.unique && !def.primaryKey) parts.push("UNIQUE");
    return parts.join(" ");
  });

  const tableName = quoteIdentifier(dialect, schema.tableName);
  const foreignKeys = (schema.foreignKeys || []).map((fk) => {
    const name = quoteIdentifier(
      dialect,
      `${schema.tableName}_${fk.dbName}_fk`
    );
    const local = quoteIdentifier(dialect, fk.dbName);
    const target = quoteIdentifier(dialect, fk.targetTableName);
    const targetPk = quoteIdentifier(dialect, fk.targetPkDbName);
    const onDelete = fk.onDelete.toUpperCase();
    const onUpdate = fk.onUpdate.toUpperCase();
    return (
      `CONSTRAINT ${name} FOREIGN KEY (${local}) ` +
      `REFERENCES ${target} (${targetPk}) ` +
      `ON DELETE ${onDelete} ON UPDATE ${onUpdate}`
    );
  });
  const body = [...columns, ...foreignKeys].join(", ");
  const suffix = dialect === "mysql" ? " ENGINE=InnoDB" : "";
  return `CREATE TABLE IF NOT EXISTS ${tableName} (${body})${suffix}`;
}

/**
 * @description Builds `CREATE INDEX` statements for a translated schema
 * @summary Emits `CREATE INDEX IF NOT EXISTS` (SQLite) / `CREATE INDEX` (MySQL)
 * statements for every declared decaf index.
 * @param {DrizzleSchema} schema The translated schema
 * @return {string[]} The DDL statements
 * @function createIndexSQL
 * @memberOf module:for-drizzle
 */
export function createIndexSQL(schema: DrizzleSchema): string[] {
  const { dialect } = schema;
  const tableName = quoteIdentifier(dialect, schema.tableName);
  const result: string[] = [];
  const indexes = schema.indexDefinitions;
  if (!indexes) return result;
  for (const index of indexes) {
    const physical = index.dbColumns?.length
      ? index.dbColumns
      : index.columns.map((c) => schema.columns[c]?.dbName ?? c);
    const columns = physical
      .map((c) => quoteIdentifier(dialect, c))
      .join(", ");
    const name = quoteIdentifier(dialect, index.name);
    const unique = index.unique ? "UNIQUE " : "";
    // SQLite and PostgreSQL both support `CREATE INDEX IF NOT EXISTS`; MySQL has
    // no such form and relies on duplicate-index tolerance in the adapter.
    const ifNotExists = dialect === "mysql" ? "" : "IF NOT EXISTS ";
    result.push(
      `CREATE ${unique}INDEX ${ifNotExists}${name} ON ${tableName} (${columns})`
    );
  }
  return result;
}

/**
 * @description Builds all DDL statements required for a model
 * @summary Translates the model, emits its table and index statements, and emits
 * join tables for many-to-many relations.
 * @template M The model type
 * @param {Constructor<M>} model The decaf model
 * @param {DrizzleDialect} dialect The target dialect
 * @return {string[]} The ordered DDL statements
 * @function generateDDL
 * @memberOf module:for-drizzle
 */
export function generateDDL<M extends Model>(
  model: Constructor<M>,
  dialect: DrizzleDialect
): string[] {
  const schema = translateModel(model, dialect);
  const statements = [createTableSQL(schema), ...createIndexSQL(schema)];
  for (const join of Object.values(schema.joinTables)) {
    statements.push(
      createJoinTableSQL(dialect, { name: getTableName(join) } as any)
    );
  }
  return statements;
}

/**
 * @description Builds the `CREATE TABLE` statement for a many-to-many join table
 * @summary Emits a `CREATE TABLE IF NOT EXISTS` for the `(source_id, target_id)`
 * pair with a composite primary key. The foreign keys to the parent tables are
 * created by the Drizzle table builders (`{@link buildJoinTable}`), not by this
 * raw DDL.
 * @param {DrizzleDialect} dialect The target dialect
 * @param {object} join The join-table descriptor
 * @return {string} The DDL statement
 */
function createJoinTableSQL(
  dialect: DrizzleDialect,
  join: {
    name: string;
    sourceTableName: string;
    targetTableName: string;
  }
): string {
  void join.sourceTableName;
  void join.targetTableName;
  const name = quoteIdentifier(dialect, join.name);
  return (
    `CREATE TABLE IF NOT EXISTS ${name} (` +
    `${quoteIdentifier(dialect, "source_id")} INTEGER NOT NULL, ` +
    `${quoteIdentifier(dialect, "target_id")} INTEGER NOT NULL, ` +
    `PRIMARY KEY (${quoteIdentifier(dialect, "source_id")}, ` +
    `${quoteIdentifier(dialect, "target_id")}))` +
    (dialect === "mysql" ? " ENGINE=InnoDB" : "")
  );
}
