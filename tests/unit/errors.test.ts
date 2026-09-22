import {
  BaseError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@decaf-ts/db-decorators";
import { ConnectionError } from "@decaf-ts/core";
import { IndexError, parseError } from "../../src";

describe("for-drizzle errors", () => {
  it("IndexError is a decaf BaseError carrying a 404 code", () => {
    const err = new IndexError("bad index definition");
    expect(err).toBeInstanceOf(BaseError);
    expect(err.code).toBe(404);
    expect(err.message).toContain("bad index definition");
  });

  it("passes an existing decaf error through unchanged", () => {
    const original = new ConflictError("dup");
    expect(parseError(original)).toBe(original);
  });

  it.each([
    "SQLITE_CONSTRAINT_UNIQUE: tst_user.tst_nif",
    "SQLITE_CONSTRAINT_PRIMARYKEY",
    "SQLITE_CONSTRAINT_FOREIGNKEY",
    "SQLITE_CONSTRAINT",
  ])("maps sqlite constraint %s to ConflictError", (message) => {
    expect(parseError(new Error(message))).toBeInstanceOf(ConflictError);
  });

  it.each([
    "ER_DUP_ENTRY",
    "ER_NO_REFERENCED_ROW",
    "ER_NO_REFERENCED_ROW_2",
    "ER_ROW_IS_REFERENCED",
    "ER_ROW_IS_REFERENCED_2",
  ])("maps mysql constraint %s to ConflictError", (message) => {
    expect(parseError(new Error(message))).toBeInstanceOf(ConflictError);
  });

  it.each(["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "ER_NO_DB_ERROR"])(
    "maps mysql missing-object %s to NotFoundError",
    (message) => {
      expect(parseError(new Error(message))).toBeInstanceOf(NotFoundError);
    }
  );

  it("maps unique wording to ConflictError", () => {
    expect(
      parseError(new Error("UNIQUE constraint failed: tst_user.tst_nif"))
    ).toBeInstanceOf(ConflictError);
    expect(parseError(new Error("Duplicate entry 'x' for key 'PRIMARY'"))).toBeInstanceOf(
      ConflictError
    );
  });

  it("maps missing-object wording to NotFoundError", () => {
    expect(parseError(new Error("no such table: tst_user"))).toBeInstanceOf(
      NotFoundError
    );
    expect(parseError(new Error("Unknown column 'foo'"))).toBeInstanceOf(
      NotFoundError
    );
  });

  it("maps driver connection failures to ConnectionError", () => {
    expect(
      parseError(new Error("connect ECONNREFUSED 127.0.0.1:3306"))
    ).toBeInstanceOf(ConnectionError);
    expect(parseError(new Error("ETIMEDOUT"))).toBeInstanceOf(ConnectionError);
    expect(parseError(new Error("PROTOCOL_CONNECTION_LOST"))).toBeInstanceOf(
      ConnectionError
    );
  });

  it("accepts string errors and falls back to InternalError with the reason", () => {
    expect(parseError("ER_DUP_ENTRY")).toBeInstanceOf(ConflictError);
    const err = parseError(new Error("something odd"), "wrapped reason");
    expect(err).toBeInstanceOf(InternalError);
    expect(err.message).toContain("wrapped reason");
  });
});
