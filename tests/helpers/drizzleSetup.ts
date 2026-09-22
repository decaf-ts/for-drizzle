import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle as sqliteDrizzle } from "drizzle-orm/better-sqlite3";
import { drizzle as mysqlDrizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { drizzle as postgresDrizzle } from "drizzle-orm/node-postgres";
import { Pool as PostgresPool } from "pg";
import { Constructor } from "@decaf-ts/decoration";
import { Model } from "@decaf-ts/decorator-validation";
import { BaseModel, Repository } from "@decaf-ts/core";
import { DBOperations, timestamp } from "@decaf-ts/db-decorators";
import { DrizzleAdapter } from "../../src";

// Decaf models must be constructible from plain objects in tests.
Model.setBuilder(Model.fromModel);

// MySQL suites share a single database and the helper drops every table when it
// creates an adapter. Jest runs test files in parallel worker processes, so two
// suites dropping tables concurrently corrupt each other's runs. Serialise the whole
// lifetime of a MySQL handle across processes with an atomic lock directory.
const MYSQL_LOCK_DIR = join(tmpdir(), "for-drizzle-mysql-test.lock");
const MYSQL_LOCK_STALE_MS = 30 * 60 * 1000;
const MYSQL_LOCK_WAIT_MS = 20 * 60 * 1000;

// PostgreSQL suites share a single database and the helper drops every table when
// it creates an adapter. Jest runs test files in parallel worker processes, so two
// suites dropping tables concurrently corrupt each other's runs. Serialise the whole
// lifetime of a PostgreSQL handle across processes with an atomic lock directory.
const POSTGRES_LOCK_DIR = join(tmpdir(), "for-drizzle-postgres-test.lock");
const POSTGRES_LOCK_STALE_MS = 30 * 60 * 1000;
const POSTGRES_LOCK_WAIT_MS = 20 * 60 * 1000;

// The helper serialises MySQL access, so waiting for the lock must not trip the
// default per-test timeout in files that do not raise it themselves.
jest.setTimeout(300000);

/**
 * Explicit per-test timeout for MySQL dialect tests. MySQL suites are serialised by
 * {@link createMysqlAdapter}, so a suite can legitimately spend minutes waiting
 * for the shared lock before its own work starts. Tests must opt into this timeout
 * (see {@link forEachDialect}) so the wait is never mistaken for a hang.
 */
export const MYSQL_TEST_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Explicit per-test timeout for PostgreSQL dialect tests. PostgreSQL suites are
 * serialised by {@link createPostgresAdapter}, so a suite can legitimately spend
 * minutes waiting for the shared lock before its own work starts.
 */
export const POSTGRES_TEST_TIMEOUT_MS = 20 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isStaleLock(lockDir: string, staleMs: number): boolean {
  try {
    return Date.now() - statSync(lockDir).mtimeMs > staleMs;
  } catch {
    return false;
  }
}

async function acquireLock(
  lockDir: string,
  label: string,
  staleMs: number,
  waitMs: number
): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, "owner"), `${process.pid}`, {
        flag: "w",
      });
      return;
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
      if (isStaleLock(lockDir, staleMs)) {
        try {
          rmSync(lockDir, { recursive: true, force: true });
        } catch {
          // another worker won the cleanup race; retry
        }
        continue;
      }
      if (Date.now() > deadline)
        throw new Error(`Timed out waiting for the shared ${label} test lock`);
      await sleep(25 + Math.floor(Math.random() * 75));
    }
  }
}

function releaseLock(lockDir: string): void {
  try {
    rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // lock already released or stolen as stale
  }
}

async function acquireMysqlLock(): Promise<void> {
  await acquireLock(
    MYSQL_LOCK_DIR,
    "MySQL",
    MYSQL_LOCK_STALE_MS,
    MYSQL_LOCK_WAIT_MS
  );
}

function releaseMysqlLock(): void {
  releaseLock(MYSQL_LOCK_DIR);
}

async function acquirePostgresLock(): Promise<void> {
  await acquireLock(
    POSTGRES_LOCK_DIR,
    "PostgreSQL",
    POSTGRES_LOCK_STALE_MS,
    POSTGRES_LOCK_WAIT_MS
  );
}

function releasePostgresLock(): void {
  releaseLock(POSTGRES_LOCK_DIR);
}

/**
 * SQL date/time columns reject the decaf default timestamp format
 * (`dd/MM/yyyy HH:mm:ss:S`): MySQL raises ER_TRUNCATED_WRONG_VALUE and SQLite
 * silently stores a non-comparable string. Re-register the BaseModel timestamps
 * with a format both dialects accept. This is a test-harness adaptation for an
 * adapter defect reported on SAA-1548; it does not mask the defect because a
 * dedicated test asserts the default format fails on MySQL.
 */
export const SQL_TIMESTAMP_FORMAT = "yyyy-MM-dd HH:mm:ss";
timestamp(DBOperations.CREATE, SQL_TIMESTAMP_FORMAT)(
  BaseModel.prototype,
  "createdAt"
);
timestamp(DBOperations.CREATE_UPDATE, SQL_TIMESTAMP_FORMAT)(
  BaseModel.prototype,
  "updatedAt"
);

export type DrizzleTestDialect = "sqlite" | "mysql" | "postgres";

export interface DrizzleTestHandle {
  adapter: DrizzleAdapter;
  dialect: DrizzleTestDialect;
  /** Closes the underlying driver and, for mysql, drops the schema. */
  cleanup: () => Promise<void>;
}

let aliasCounter = 0;

function nextAlias(dialect: DrizzleTestDialect): string {
  aliasCounter += 1;
  return `drizzle_test_${dialect}_${process.pid}_${aliasCounter}`;
}

/**
 * Creates a live, in-process SQLite adapter backed by better-sqlite3 `:memory:`.
 * Foreign keys are enabled so relation/FK tests exercise real constraints.
 */
export async function createSqliteAdapter(
  models: Constructor<Model>[] = []
): Promise<DrizzleTestHandle> {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = sqliteDrizzle(sqlite);
  const adapter = new DrizzleAdapter(
    { dialect: "sqlite", db: db as any, client: sqlite },
    nextAlias("sqlite")
  );
  await adapter.initialize();
  if (models.length) await adapter.index(...models);
  return {
    adapter,
    dialect: "sqlite",
    cleanup: async () => {
      sqlite.close();
    },
  };
}

export function mysqlUri(): string | undefined {
  return process.env.MYSQL_URI;
}

export function hasMysql(): boolean {
  return !!mysqlUri();
}

async function dropAllMysqlTables(pool: mysql.Pool): Promise<void> {
  const [rows] = await pool.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()"
  );
  const names = (rows as any[]).map((r) => r.name ?? r.TABLE_NAME);
  if (!names.length) return;
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const name of names) {
    await pool.query(`DROP TABLE IF EXISTS \`${name}\``);
  }
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");
}

/**
 * Creates a live MySQL adapter against the docker-compose service described by
 * MYSQL_URI. Returns `undefined` when MYSQL_URI is not configured so suites can
 * skip with an explicit message instead of silently downgrading.
 */
export async function createMysqlAdapter(
  models: Constructor<Model>[] = []
): Promise<DrizzleTestHandle | undefined> {
  const uri = mysqlUri();
  if (!uri) return undefined;
  await acquireMysqlLock();
  try {
    const pool = mysql.createPool({ uri, connectionLimit: 5 });
    const db = mysqlDrizzle(pool);
    await dropAllMysqlTables(pool);
    const adapter = new DrizzleAdapter(
      { dialect: "mysql", db: db as any, client: pool },
      nextAlias("mysql")
    );
    await adapter.initialize();
    if (models.length) await adapter.index(...models);
    return {
      adapter,
      dialect: "mysql",
      cleanup: async () => {
        try {
          await dropAllMysqlTables(pool);
          await pool.end();
        } finally {
          releaseMysqlLock();
        }
      },
    };
  } catch (e: unknown) {
    releaseMysqlLock();
    throw e;
  }
}

export function postgresUri(): string | undefined {
  return process.env.POSTGRES_URI;
}

export function hasPostgres(): boolean {
  return !!postgresUri();
}

async function dropAllPostgresTables(pool: PostgresPool): Promise<void> {
  await pool.query(
    "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
  );
}

/**
 * Creates a live PostgreSQL adapter against the docker-compose service described by
 * POSTGRES_URI. Returns `undefined` when POSTGRES_URI is not configured so
 * suites can skip with an explicit message instead of silently downgrading.
 */
export async function createPostgresAdapter(
  models: Constructor<Model>[] = []
): Promise<DrizzleTestHandle | undefined> {
  const uri = postgresUri();
  if (!uri) return undefined;
  await acquirePostgresLock();
  try {
    const pool = new PostgresPool({ connectionString: uri, max: 5 });
    const db = postgresDrizzle(pool);
    await dropAllPostgresTables(pool);
    const adapter = new DrizzleAdapter(
      { dialect: "postgres" as any, db: db as any, client: pool as any },
      nextAlias("postgres")
    );
    await adapter.initialize();
    if (models.length) await adapter.index(...models);
    return {
      adapter,
      dialect: "postgres",
      cleanup: async () => {
        try {
          await dropAllPostgresTables(pool);
          await pool.end();
        } finally {
          releasePostgresLock();
        }
      },
    };
  } catch (e: unknown) {
    releasePostgresLock();
    throw e;
  }
}

/**
 * Creates a live handle for every configured dialect: sqlite always, plus mysql
 * when MYSQL_URI is set and postgres when POSTGRES_URI is set.
 */
export async function createTestAdapters(
  models: Constructor<Model>[] = []
): Promise<DrizzleTestHandle[]> {
  const handles: DrizzleTestHandle[] = [await createSqliteAdapter(models)];
  const mysqlHandle = await createMysqlAdapter(models);
  if (mysqlHandle) handles.push(mysqlHandle);
  const postgresHandle = await createPostgresAdapter(models);
  if (postgresHandle) handles.push(postgresHandle);
  return handles;
}

/**
 * Resolves a Drizzle repository for a model against an already initialized handle.
 */
export function drizzleRepository<M extends Model>(
  adapter: DrizzleAdapter,
  model: Constructor<M>
): Repository<M, DrizzleAdapter> {
  return Repository.forModel(model, adapter.alias) as Repository<
    M,
    DrizzleAdapter
  >;
}

/**
 * Describes/executes a test body once per available dialect. SQLite always runs;
 * MySQL runs only when MYSQL_URI is configured; PostgreSQL runs only when
 * POSTGRES_URI is configured. The suite reports the dialects it actually
 * exercised so a missing backend is never silently treated as passing.
 */
export function forEachDialect(
  name: string,
  fn: (handle: DrizzleTestHandle) => void
): void {
  const hasSql = true;
  const hasMy = hasMysql();
  const hasPg = hasPostgres();
  const dialects: DrizzleTestDialect[] = ["sqlite"];
  if (hasMy) dialects.push("mysql");
  if (hasPg) dialects.push("postgres");
  describe(name, () => {
    if (!hasMy) {
      it("reports mysql coverage", () => {
        console.warn(
          "[drizzle-tests] MYSQL_URI is not set: MySQL dialect NOT exercised in this run"
        );
        expect(hasSql).toBe(true);
      });
    }
    if (!hasPg) {
      it("reports postgres coverage", () => {
        console.warn(
          "[drizzle-tests] POSTGRES_URI is not set: PostgreSQL dialect NOT exercised in this run"
        );
        expect(hasSql).toBe(true);
      });
    }
    dialects.forEach((dialect) => {
      const timeout =
        dialect === "mysql"
          ? MYSQL_TEST_TIMEOUT_MS
          : dialect === "postgres"
            ? POSTGRES_TEST_TIMEOUT_MS
            : undefined;
      it(
        `${dialect}`,
        async () => {
          const handle =
            dialect === "sqlite"
              ? await createSqliteAdapter()
              : dialect === "mysql"
                ? await createMysqlAdapter()
                : await createPostgresAdapter();
          if (!handle) throw new Error(`${dialect} handle unavailable`);
          try {
            await fn(handle);
          } finally {
            await handle.cleanup();
          }
        },
        timeout
      );
    });
  });
}
