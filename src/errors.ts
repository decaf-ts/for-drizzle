import { BaseError } from "@decaf-ts/db-decorators";
import {
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { ConnectionError } from "@decaf-ts/core";

/**
 * @description Error thrown when there is an issue with Drizzle indexes
 * @summary Represents an error related to index generation or handling within
 * the Drizzle adapter (invalid index definitions, duplicate index names, etc.).
 * @param {string|Error} msg The error message or Error object
 * @class IndexError
 * @memberOf module:for-drizzle
 */
export class IndexError extends BaseError {
  constructor(msg: string | Error) {
    super(IndexError.name, msg, 404);
  }
}

/**
 * @description Parses a driver-level error into a decaf error
 * @summary Normalises the different error shapes produced by `better-sqlite3` and
 * `mysql2` into the decaf error hierarchy so repositories can react to
 * `ConflictError`, `NotFoundError` and `ConnectionError` consistently across
 * dialects.
 * @param {unknown} err The original driver error
 * @param {string} [reason] Optional human readable reason to attach
 * @return {BaseError} The normalised decaf error
 * @function parseError
 * @memberOf module:for-drizzle
 */
export function parseError<E extends BaseError>(
  err: unknown,
  reason?: string
): E {  if (err instanceof BaseError) return err as unknown as E;

  const code: string = (
    typeof err === "string" ? err : (err as Error)?.message ?? `${err}`
  ).toString();

  // SQLite / better-sqlite3 constraint codes
  if (/SQLITE_CONSTRAINT_UNIQUE|SQLITE_CONSTRAINT_PRIMARYKEY/gi.test(code))
    return new ConflictError(reason ?? code) as unknown as E;
  if (/SQLITE_CONSTRAINT_FOREIGNKEY/gi.test(code))
    return new ConflictError(reason ?? code) as unknown as E;
  if (/SQLITE_CONSTRAINT/gi.test(code))
    return new ConflictError(reason ?? code) as unknown as E;

  // MySQL / mysql2 error codes
  switch (code) {
    case "ER_DUP_ENTRY":
    case "ER_NO_REFERENCED_ROW":
    case "ER_NO_REFERENCED_ROW_2":
    case "ER_ROW_IS_REFERENCED":
    case "ER_ROW_IS_REFERENCED_2":
      return new ConflictError(reason ?? code) as unknown as E;
    case "ER_NO_SUCH_TABLE":
    case "ER_BAD_FIELD_ERROR":
    case "ER_NO_DB_ERROR":
      return new NotFoundError(reason ?? code) as unknown as E;
    default:
      break;
  }

  if (/UNIQUE constraint failed|Duplicate entry|duplicate key/gi.test(code))
    return new ConflictError(reason ?? code) as unknown as E;
  if (/no such table|Unknown column|does not exist|not found/gi.test(code))
    return new NotFoundError(reason ?? code) as unknown as E;

  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|PROTOCOL_CONNECTION_LOST/gi.test(code))
    return new ConnectionError(code) as unknown as E;

  return new InternalError(reason ?? code) as unknown as E;
}

/**
 * @description Detects a MySQL duplicate-index-name error
 * @summary `CREATE INDEX` has no `IF NOT EXISTS` form on MySQL, so re-applying
 * a schema raises error `1061`/`ER_DUP_KEYNAME` when the index already exists.
 * The DDL materialiser uses this guard to make `Adapter.index` idempotent.
 * @param {unknown} err The original driver error
 * @return {boolean} True when the index already exists
 * @function isDuplicateIndexError
 * @memberOf module:for-drizzle
 */
export function isDuplicateIndexError(err: unknown): boolean {
  if (!err) return false;
  // Drizzle wraps driver errors (`DrizzleQueryError`) and exposes the original
  // `mysql2` error as `cause`, so walk the chain looking for the duplicate-index
  // signature instead of only inspecting the outer error.
  let current: any = err;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current.code === "ER_DUP_KEYNAME" || current.errno === 1061)
      return true;
    if (/duplicate key name/i.test(current.message ?? "")) return true;
    current = current.cause;
  }
  return /duplicate key name/i.test((err as Error)?.message ?? `${err}`);
}
