/**
 * @description Identifier for the Drizzle database flavour
 * @summary Constant string that identifies the persistence flavour as "drizzle" for use in
 * adapter selection, model `@uses()` decoration and repository lookup.
 * @const DrizzleFlavour
 * @memberOf module:for-drizzle
 */
export const DrizzleFlavour = "drizzle";

/**
 * @description Supported Drizzle SQL dialects
 * @summary The dialects this adapter can translate decaf model decoration into. All
 * dialects share the same decaf surface but differ in column types and DDL features,
 * which the schema translator resolves per dialect.
 * @const DrizzleDialects
 * @memberOf module:for-drizzle
 */
export const DrizzleDialects = ["sqlite", "mysql", "postgres"] as const;

/**
 * @description Metadata/query keys specific to the Drizzle adapter
 * @summary Reserved keys used to store Drizzle-specific metadata (generated Drizzle
 * schema objects, dialect information and join-table descriptors) alongside decaf
 * persistence metadata.
 * @const DrizzleKeys
 * @memberOf module:for-drizzle
 */
export const DrizzleKeys = {
  /** @description Key under which the generated Drizzle table is stored */
  SCHEMA: "drizzle-schema",
  /** @description Key under which the resolved dialect is stored */
  DIALECT: "drizzle-dialect",
  /** @description Prefix for generated join tables (many-to-many) */
  JOIN_TABLE_PREFIX: "drizzle_join",
  /** @description Default varchar length used for string columns */
  DEFAULT_STRING_LENGTH: 255,
  /** @description Default timestamp storage type */
  TIMESTAMP: "timestamp",
  /** @description Suffix appended to generated index names */
  INDEX_SUFFIX: "index",
} as const;

/**
 * @description Default SQL identifier/table prefix separator
 * @summary Separator used when composing index names from table/column segments.
 * @const DrizzleSeparator
 * @memberOf module:for-drizzle
 */
export const DrizzleSeparator = "_";

/**
 * @description SQL-safe timestamp format used by the Drizzle adapter
 * @summary MySQL/SQLite `DATETIME` columns reject decaf's default timestamp format
 * (`dd-MM-yyyy HH:mm:ss:S`). The adapter overrides the `@date()` decoration for
 * the Drizzle flavour with this format so persisted dates are accepted by both
 * dialects.
 * @const SQL_TIMESTAMP_FORMAT
 * @memberOf module:for-drizzle
 */
export const SQL_TIMESTAMP_FORMAT = "yyyy-MM-dd HH:mm:ss";
