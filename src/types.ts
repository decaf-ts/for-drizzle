import type { AdapterFlags, Context } from "@decaf-ts/core";
import type { SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { DrizzleDialects } from "./constants";

/**
 * @description Supported Drizzle dialect names
 * @summary A literal union of the dialect identifiers understood by the schema
 * translator and the adapter (`"sqlite"`, `"mysql"` or `"postgres"`).
 * @typedef DrizzleDialect
 * @memberOf module:for-drizzle
 */
export type DrizzleDialect = (typeof DrizzleDialects)[number];

/**
 * @description Union of the drizzle database instances supported by the adapter
 * @summary The adapter accepts a `better-sqlite3` backed SQLite database, a
 * `mysql2` backed MySQL database or a `node-postgres` backed PostgreSQL database.
 * The concrete instance is provided by the consumer, keeping driver construction out of
 * the adapter.
 * @typedef DrizzleDatabase
 * @memberOf module:for-drizzle
 */
export type DrizzleDatabase =
  | BetterSQLite3Database<Record<string, unknown>>
  | MySql2Database<Record<string, unknown>>
  | NodePgDatabase<Record<string, unknown>>;

/**
 * @description Connection/configuration for the Drizzle adapter
 * @summary Wraps an already constructed Drizzle database instance together with
 * the dialect it was built for. The adapter translates decaf model decoration into
 * dialect-specific Drizzle schemas, so the dialect must be declared explicitly.
 * @property {DrizzleDialect} dialect - The SQL dialect backing the database
 * @property {DrizzleDatabase} db - The constructed Drizzle database instance
 * @property {object} [client] - Optional underlying driver handle (e.g. the
 * better-sqlite3 `Database` or the mysql2 `Pool`) used for clean shutdown
 * @typedef DrizzleConfig
 * @memberOf module:for-drizzle
 */
export type DrizzleConfig = {
  dialect: DrizzleDialect;
  db: DrizzleDatabase;
  client?: {
    close?: (...args: any[]) => any;
    end?: (...args: any[]) => any;
    function?: (...args: any[]) => any;
  };
};

/**
 * @description Configuration flags for Drizzle operations
 * @summary Extends the base adapter flags with Drizzle-specific toggles.
 * @interface DrizzleFlags
 * @memberOf module:for-drizzle
 */
export interface DrizzleFlags extends AdapterFlags {
  /**
   * @description When true, `@index()` declarations also emit `CREATE INDEX`
   * statements through the adapter's `index()` method.
   */
  forceNamedIndexes?: boolean;
}

/**
 * @description Context type used by the Drizzle adapter
 * @summary Alias for the decaf `Context` parameterised with {@link DrizzleFlags}.
 * @typedef DrizzleContext
 * @memberOf module:for-drizzle
 */
export type DrizzleContext = Context<DrizzleFlags>;

/**
 * @description Raw query type understood by the adapter
 * @summary The adapter executes Drizzle `SQL` objects directly against the
 * underlying database instance. Raw strings are wrapped into `SQL` by the adapter.
 * @typedef DrizzleQuery
 * @memberOf module:for-drizzle
 */
export type DrizzleQuery = SQL;

/**
 * @description A row as returned by the underlying driver
 * @summary Rows are keyed by the Drizzle table's property names (the model
 * property names), not the physical database column names.
 * @typedef DrizzleRecord
 * @memberOf module:for-drizzle
 */
export type DrizzleRecord = Record<string, any>;
