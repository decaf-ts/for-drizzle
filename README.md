![Banner](./workdocs/assets/decaf-logo.svg)

# Decaf.ts — Drizzle Integration

A full adapter layer that plugs Decaf.ts models, repositories and query primitives into SQL databases through [Drizzle ORM](https://orm.drizzle.team/). It keeps the same Repository-first API you use across the other Decaf adapters and translates decaf's model decoration into Drizzle table definitions for **SQLite** (better-sqlite3), **MySQL** (mysql2) and **PostgreSQL** (node-postgres).

It provides:

- `DrizzleAdapter`: connection/`index()` DDL management, CRUD/bulk operations, raw SQL, sequences, transaction locks, and error translation
- `DrizzleRepository`: typed repository binding for `Repository.forModel(...)`
- Query layer: `DrizzleStatement` and `DrizzlePaginator` translating Decaf statements/conditions to Drizzle SQL
- Schema translation: decaf decoration (`@table`, `@column`, `@pk`, `@index`, `@unique`, relations) → Drizzle tables at runtime
- Migrations: `DrizzleMigrator` running Drizzle's programmatic migrator and generating per-model DDL
- `DrizzleDispatch` change/observer plumbing and `DrizzleContextLock` transaction coordination

> This package is schema-first: unlike TypeORM, Drizzle has no decorator-driven entity layer, so decaf decoration is translated into Drizzle schema definitions at runtime. Validation stays on the decaf side (`@decaf-ts/decorator-validation`).


![Licence](https://img.shields.io/github/license/decaf-ts/for-drizzle.svg?style=plastic)
![GitHub language count](https://img.shields.io/github/languages/count/decaf-ts/for-drizzle?style=plastic)
![GitHub top language](https://img.shields.io/github/languages/top/decaf-ts/for-drizzle?style=plastic)

[![Build & Test](https://github.com/decaf-ts/for-drizzle/actions/workflows/nodejs-build-prod.yaml/badge.svg)](https://github.com/decaf-ts/for-drizzle/actions/workflows/nodejs-build-prod.yaml)
[![CodeQL](https://github.com/decaf-ts/for-drizzle/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/decaf-ts/for-drizzle/actions/workflows/codeql-analysis.yml)[![Snyk Analysis](https://github.com/decaf-ts/for-drizzle/actions/workflows/snyk-analysis.yaml/badge.svg)](https://github.com/decaf-ts/for-drizzle/actions/workflows/snyk-analysis.yaml)
[![Pages builder](https://github.com/decaf-ts/for-drizzle/actions/workflows/pages.yaml/badge.svg)](https://github.com/decaf-ts/for-drizzle/actions/workflows/pages.yaml)
[![.github/workflows/release-on-tag.yaml](https://github.com/decaf-ts/for-drizzle/actions/workflows/release-on-tag.yaml/badge.svg?event=release)](https://github.com/decaf-ts/for-drizzle/actions/workflows/release-on-tag.yaml)

![Open Issues](https://img.shields.io/github/issues/decaf-ts/for-drizzle.svg)
![Closed Issues](https://img.shields.io/github/issues-closed/decaf-ts/for-drizzle.svg)
![Pull Requests](https://img.shields.io/github/issues-pr-closed/decaf-ts/for-drizzle.svg)
![Maintained](https://img.shields.io/badge/Maintained%3F-yes-green.svg)

![Forks](https://img.shields.io/github/forks/decaf-ts/for-drizzle.svg)
![Stars](https://img.shields.io/github/stars/decaf-ts/for-drizzle.svg)
![Watchers](https://img.shields.io/github/watchers/decaf-ts/for-drizzle.svg)

![Node Version](https://img.shields.io/badge/dynamic/json.svg?url=https%3A%2F%2Fraw.githubusercontent.com%2Fbadges%2Fshields%2Fmaster%2Fpackage.json&label=Node&query=$.engines.node&colorB=blue)
![NPM Version](https://img.shields.io/badge/dynamic/json.svg?url=https%3A%2F%2Fraw.githubusercontent.com%2Fbadges%2Fshields%2Fmaster%2Fpackage.json&label=NPM&query=$.engines.npm&colorB=purple)

Documentation [here](https://decaf-ts.github.io/for-drizzle/), Test results [here](https://decaf-ts.github.io/for-drizzle/workdocs/reports/html/test-report.html) and Coverage [here](https://decaf-ts.github.io/for-drizzle/workdocs/reports/coverage/lcov-report/index.html)



### Description

`@decaf-ts/for-drizzle` integrates [Drizzle ORM](https://orm.drizzle.team/) into the decaf-ts data stack. It exposes the same adapter/repository/query primitives you use with the other decaf-ts backends (TypeORM, Nano, Pouch, HTTP, …) while translating decaf's model decoration into Drizzle table definitions at runtime.

#### Decoration path decision

Drizzle is **schema-first**: unlike TypeORM it has no decorator-driven entity layer, so there is no `flavouredAs` extension point to hook decaf decorators into. Following the board decision recorded in the SAA-1531 context manifest, `for-drizzle` therefore takes the **full adapter path** (for-nano style):

- decaf model decoration metadata is translated into dialect-specific Drizzle schema objects at runtime (`translateModel`);
- `Repository.forModel(Model)` resolves a `DrizzleRepository` once `@decaf-ts/for-drizzle` is imported (import registers the `drizzle` flavour and calls `DrizzleAdapter.decoration()`, which wires the drizzle-flavoured model decorations);
- `@date()` (and the `@timestamp`/`@createdAt`/`@updatedAt` decorations built on it) is overridden for the drizzle flavour with the SQL-safe `SQL_TIMESTAMP_FORMAT` constant (`yyyy-MM-dd HH:mm:ss`), because SQLite and MySQL `DATETIME` columns reject decaf's default timestamp format (`dd-MM-yyyy HH:mm:ss:S`);
- validation is **not** delegated to Drizzle. Drizzle performs no model validation, so `@decaf-ts/decorator-validation` remains the single validation authority on the decaf side.

#### Core elements

- **DrizzleAdapter**
  - Bridges decaf `Repository` operations with a consumer-supplied Drizzle database instance (`better-sqlite3`, `mysql2` or `node-postgres`).
  - Implements repository-friendly CRUD: `create`, `read`, `update`, `delete`, plus the bulk variants.
  - Translates decaf `Statement`/`Paginator` to Drizzle `SQL` and executes it against the driver.
  - `raw(query)` executes a Drizzle `SQL` object or a raw SQL string directly; `index(models)` emits and applies DDL.
  - Remaps records between decaf's physical-column keying and Drizzle's property keying.
  - Normalises driver errors into decaf's error hierarchy through `parseError`.
  - Exposes `transactionLock()` returning a `DrizzleContextLock`.

- **DrizzleRepository**
  - A typed alias binding `Repository` to `DrizzleAdapter`, `DrizzleFlags` and `DrizzleContext`.

- **DrizzleStatement / DrizzlePaginator**
  - `DrizzleStatement` translates decaf conditions/operators into Drizzle SQL (`eq`, `gt`, `inArray`, `like`, `and`/`or`, ordering, projection, aggregations).
  - `DrizzlePaginator` wraps the statement in a count subquery plus `limit`/`offset`.

- **DrizzleDispatch / DrizzleContextLock**
  - `DrizzleDispatch` implements the `Dispatch` contract for observer/change notification.
  - `DrizzleContextLock` coordinates transactions: native `BEGIN`/`COMMIT`/`ROLLBACK` for SQLite, semaphore-style locking for MySQL and PostgreSQL (their pooled connections cannot bind a bare `BEGIN` to subsequent statements).

- **DrizzleMigrator**
  - `migrate(config, migrationsFolder)` runs Drizzle's programmatic migrator (the same SQL files `drizzle-kit generate` produces), dispatching to the `better-sqlite3`, `mysql2` or `node-postgres` dialect migrator.
  - `generate(config, models, outFolder)` emits dialect DDL per model for review/versioning.

- **Types and constants**
  - `DrizzleFlavour` (`"drizzle"`), `DrizzleDialects` (`"sqlite"`, `"mysql"`, `"postgres"`), `DrizzleConfig`, `DrizzleFlags`, `DrizzleContext`, `DrizzleQuery`, `SQL_TIMESTAMP_FORMAT` (SQL-safe `@date()` format override).

#### Decoration → Drizzle mapping

`translateModel(model, dialect)` reads decaf decoration metadata and produces a Drizzle table. Coverage:

| decaf decoration | metadata key | SQLite representation | MySQL representation | PostgreSQL representation |
| --- | --- | --- | --- | --- |
| `@model()` / `@table(name)` | `PersistenceKeys.TABLE` | `sqliteTable(name)` (`??` prefix → `drizzle_`) | `mysqlTable(name)` | `pgTable(name)` (`??` prefix → `drizzle_`) |
| `@column(name)` | `DBKeys.COLUMN` | column property uses the physical `dbName` | same | same |
| `@pk({ type })` | `DBKeys.ID` | `integer().primaryKey()` / `text().primaryKey()`; `autoincrement` when generated | `int().primaryKey().autoincrement()` / `varchar().primaryKey()` | `integer().primaryKey()` / `bigint({ mode: "bigint" }).primaryKey()`; no inline autoincrement — generated numeric PKs emit `GENERATED BY DEFAULT AS IDENTITY` DDL |
| `@required()` | `ValidationKeys.REQUIRED` | `.notNull()` | `.notNull()` | `.notNull()` |
| `@unique()` | `PersistenceKeys.UNIQUE` | `.unique()` | `.unique()` | `.unique()` |
| `@maxlength(n)` | `ValidationKeys.MAX_LENGTH` | `text({ length })` | `varchar({ length: min(n, 65535) })` | `varchar({ length: min(n, 10485760) })`; unbounded `text` otherwise |
| `@index()` | `PersistenceKeys.INDEX` | table extra `index()` + `CREATE INDEX` DDL | table extra `index()` + `CREATE INDEX` DDL | `pgIndex()` extra built inside the table callback (`pg-core` resolves index columns eagerly) + `CREATE INDEX` DDL |
| `@version()` | `DBKeys.VERSION` | `integer` | `int` | `integer` |
| `@timestamp()` | `DBKeys.TIMESTAMP` | `integer({ mode: "timestamp_ms" })` | `datetime` | `timestamp` |
| `@generated()` / sequence | `DBKeys.GENERATED` / `SequenceOptions.generated` | `integer().primaryKey({ autoIncrement: true })` | `int().primaryKey().autoincrement()` | numeric PK marked `GENERATED BY DEFAULT AS IDENTITY` by `generateDDL`/`index()` |
| `@oneToOne()` | `PersistenceKeys.RELATIONS` | FK column + `foreignKey` extra | FK column + `foreignKey` extra | FK column + `foreignKey` extra (built inside the table callback) |
| `@manyToOne()` | `PersistenceKeys.RELATIONS` | FK column + `foreignKey` extra | FK column + `foreignKey` extra | FK column + `foreignKey` extra (built inside the table callback) |
| `@manyToMany()` | `PersistenceKeys.RELATIONS` | generated join table + composite PK | generated join table + composite PK | generated join table + composite PK |
| `@oneToMany()` | `PersistenceKeys.RELATIONS` | inverse side; represented on the owning FK, no column emitted | same | same |

Property type mapping (`resolveColumnType`):

| decaf type | SQLite | MySQL | PostgreSQL |
| --- | --- | --- | --- |
| `String` | `text` | `varchar` | `text` (`varchar(n)` with `@maxlength`) |
| `Number` | `integer` | `int` | `integer` |
| `BigInt` | `integer` (number mode; SQLite has no bigint mode) | `bigint` (bigint mode) | `bigint` (bigint mode) |
| `Boolean` | `integer({ mode: "boolean" })` | `boolean` | `boolean` |
| `Date` | `integer({ mode: "timestamp_ms" })` | `datetime` | `timestamp` |
| object / other | `text` | `varchar` | `jsonb` |

#### Validation stance

Drizzle has no validation layer comparable to TypeORM's. Validation is therefore **not** delegated to Drizzle: `@decaf-ts/decorator-validation` decorators (`@required`, `@maxlength`, …) remain authoritative on the model and are only *reflected* into Drizzle constraints (`NOT NULL`, column length, `UNIQUE`). All decaf validation errors continue to be thrown decaf-side.

#### Design considerations

- **Dialect-explicit config**: the consumer constructs the Drizzle database and declares the dialect, keeping driver creation out of the adapter.
- **Property/column key remapping**: decaf `Adapter.prepare`/`revert` key records by physical column name, while Drizzle builders key values by TS property name; the adapter remaps in both directions.
- **Identity-sensitive schema cache**: translated tables are cached by model constructor and dialect (a `WeakMap` keyed by the constructor) so the same table object is reused across calls and two distinct classes that share a `name` cannot collide.
- **Raw statement scoping**: `Statement.raw()` is gated behind `allowRawStatements`, rejects raw SQL strings outright, and executes a Drizzle `SQL` object only when it references the statement's own table (fail-closed: a query that cannot be serialised for the scope check is rejected too). The unrestricted raw surface is `adapter.raw()`, which accepts raw SQL strings and Drizzle `SQL` objects without the statement-level scope check or the `allowRawStatements` gate.
- **Linear-time `REGEXP`**: the SQLite `regexp` function registered by the adapter uses Google's RE2 (`re2-wasm`) instead of the native `RegExp`, so a user-supplied pattern cannot cause catastrophic backtracking (ReDoS). RE2 runs in Unicode mode, so patterns relying on lookaround or backreferences (which RE2 does not support) are rejected.
- **DDL identifier safety**: generated DDL is executed through `sql.raw`, so table/column/index identifiers are validated as plain SQL identifiers at translation time (invalid identifiers fail fast with an `InternalError` before any DDL is built) and embedded quote characters are doubled when quoting.
- **Error normalisation**: SQLite `SQLITE_CONSTRAINT*` and MySQL `ER_DUP_ENTRY` are mapped to decaf `ConflictError`/`NotFoundError`/`ConnectionError`; PostgreSQL driver errors are matched by the same generic patterns (`duplicate key` → `ConflictError`, `does not exist` → `NotFoundError`, connection failures → `ConnectionError`).
- **Testability**: in-repo SQLite (better-sqlite3) unit tests, a docker-compose MySQL service for live parity testing, and a `POSTGRES_URI`-configured PostgreSQL backend for the postgres dialect suites.


### How to Use

This guide shows practical, non-duplicated examples for the public APIs of `@decaf-ts/for-drizzle`. As with the other decaf adapters, obtain a repository with `Repository.forModel(Model)`; importing `@decaf-ts/for-drizzle` registers the `drizzle` flavour and the repository factory wires the `DrizzleAdapter` for you.

For a step-by-step walkthrough see the [Setup and Installation](./workdocs/tutorials/Setup%20and%20Installation.md) tutorial; model decoration and relations are covered in depth in [Model Decoration and Relations](./workdocs/tutorials/Model%20Decoration%20and%20Relations.md), schema evolution in [Migrations](./workdocs/tutorials/Migrations.md), and the test backends in [Testing](./workdocs/tutorials/Testing.md).

Prerequisites:

- A reachable SQLite, MySQL or PostgreSQL database.
- Install: `npm i @decaf-ts/for-drizzle @decaf-ts/core @decaf-ts/db-decorators @decaf-ts/decorator-validation drizzle-orm better-sqlite3` (add `mysql2` for MySQL, or `pg` for PostgreSQL).

---

#### 0) Construct the Drizzle database and adapter

Description: The consumer builds the Drizzle instance and declares the dialect; the adapter never creates connections.

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { DrizzleAdapter } from "@decaf-ts/for-drizzle";

const sqlite = new Database(":memory:");
const db = drizzle(sqlite);

const adapter = new DrizzleAdapter({ dialect: "sqlite", db, client: sqlite });
await adapter.initialize();
```

For MySQL:

```ts
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";

const pool = mysql.createPool({ uri: process.env.MYSQL_URI });
const db = drizzle(pool);
const adapter = new DrizzleAdapter({ dialect: "mysql", db, client: pool });
await adapter.initialize();
```

For PostgreSQL:

```ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const pool = new Pool({ connectionString: process.env.POSTGRES_URI });
const db = drizzle(pool);
const adapter = new DrizzleAdapter({ dialect: "postgres", db, client: pool });
await adapter.initialize();
```

#### 1) Define a model and get a repository

Description: Decorate a model with the usual decaf decorators. The `drizzle` flavour is auto-wired by importing the package.

```ts
import { BaseModel, Repository, pk, uses, index } from "@decaf-ts/core";
import { model, ModelArg, required } from "@decaf-ts/decorator-validation";
import type { DrizzleRepository } from "@decaf-ts/for-drizzle";

@uses("drizzle")
@model()
class UserModel extends BaseModel {
  @pk({ type: "String" })
  id!: string;

  @required()
  @index(["name"])
  name!: string;

  constructor(arg?: ModelArg<UserModel>) {
    super(arg);
  }
}

const repo: DrizzleRepository<UserModel> =
  Repository.forModel<UserModel, DrizzleRepository<UserModel>>(UserModel);
```

#### 2) Create and read

```ts
const created = await repo.create(new UserModel({ id: "user:1", name: "Ada" }));
const loaded = await repo.read("user:1");
```

#### 3) Bulk create / read / update / delete

```ts
const users = [
  new UserModel({ id: "user:2", name: "Lin" }),
  new UserModel({ id: "user:3", name: "Grace" }),
];
const createdMany = await repo.createAll(users);
const fetchedMany = await repo.readAll(["user:2", "user:3"]);

let user = await repo.read("user:1");
user.name = "Ada Lovelace";
user = await repo.update(user);

const updatedMany = await repo.updateAll([user]);
const deletedMany = await repo.deleteAll(["user:2", "user:3"]);
```

#### 4) Select, conditions and pagination

```ts
import { Condition, OrderDirection } from "@decaf-ts/core";

const all = await repo.select().execute();
const projected = await repo.select(["name"]).execute();

const nameEq = Condition.attribute<UserModel>("name").eq("Ada Lovelace");
const named = await repo.select().where(nameEq).execute();

const ordered = await repo
  .select()
  .orderBy(["name", OrderDirection.ASC])
  .execute();

// paginate() is asynchronous and returns a DrizzlePaginator; pages are 1-based
const paginator = await repo.select().paginate(20);
const firstPage = await paginator.page(1);
const total = paginator.recordCount; // available after the first page() call
```

#### 5) Raw SQL and DDL/indexing

Description: `raw` accepts a Drizzle `SQL` object (or a raw SQL string) and a required `docsOnly` flag: `true` returns the rows directly, `false` returns a `{ data, count }` envelope. `index` translates each supplied model and applies its table + index DDL; it takes the model constructors as separate arguments.

```ts
import { sql } from "drizzle-orm";
import { DrizzleAdapter } from "@decaf-ts/for-drizzle";

const rows = await adapter.raw(sql`SELECT count(*) AS total FROM users`, true);
const envelope = await adapter.raw("SELECT * FROM users", false);

// Emit and apply the model's CREATE TABLE + CREATE INDEX statements
await adapter.index(UserModel);
```

> Note: `adapter.raw()` is the unrestricted raw surface. The statement-level `raw()` (e.g. `repo.select().raw(...)`) is stricter: it is gated behind the `allowRawStatements` context flag, rejects raw SQL strings outright, and executes a Drizzle `SQL` object only when it references the statement's own table — use `adapter.raw()` when you need unrestricted raw execution.

#### 6) Migrations

Description: `DrizzleMigrator.migrate` runs Drizzle's programmatic migrator against the standard migrations folder produced by `drizzle-kit generate`. `generate` emits per-model DDL so it can be reviewed and versioned. See the [Migrations](./workdocs/tutorials/Migrations.md) tutorial for the full workflow.

```ts
import { DrizzleMigrator } from "@decaf-ts/for-drizzle";

await DrizzleMigrator.migrate(
  { dialect: "sqlite", db },
  "./migrations"
);

const files = await DrizzleMigrator.generate(
  { dialect: "mysql", db },
  [UserModel],
  "./migrations/generated"
);
```

#### 7) Transactions

```ts
await adapter.transactionLock("user:1").then(async () => {
  await repo.create(new UserModel({ id: "user:4", name: "Alan" }));
});
```

Under the hood `DrizzleContextLock` issues native `BEGIN`/`COMMIT`/`ROLLBACK` statements for SQLite (single connection); for MySQL and PostgreSQL the pooled connection prevents binding a bare `BEGIN` to subsequent statements, so only the semaphore-style concurrency gating is applied.

#### 8) Choose the backend via DrizzleFlavour / read VERSION

```ts
import { DrizzleFlavour, VERSION } from "@decaf-ts/for-drizzle";

console.log(DrizzleFlavour); // "drizzle"
console.log("for-drizzle version:", VERSION);
```

#### 9) Relations

Description: relations are declared with the standard decaf relation decorators; the adapter materialises them in the generated Drizzle schema (foreign keys, generated FK columns, join tables).

```ts
import {
  BaseModel,
  Repository,
  pk,
  column,
  uses,
  oneToOne,
  manyToOne,
  manyToMany,
  oneToMany,
} from "@decaf-ts/core";
import { model, ModelArg, required } from "@decaf-ts/decorator-validation";
import { Cascade } from "@decaf-ts/db-decorators";

@uses("drizzle")
@model()
class Profile extends BaseModel {
  @pk({ type: "String" })
  id!: string;

  constructor(arg?: ModelArg<Profile>) {
    super(arg);
  }
}

@uses("drizzle")
@model()
class Post extends BaseModel {
  @pk({ type: "String" })
  id!: string;

  @manyToOne(() => UserModel, { delete: Cascade.CASCADE, update: Cascade.CASCADE })
  author!: UserModel;

  @manyToMany(() => Tag, { delete: Cascade.CASCADE })
  tags!: Tag[];

  constructor(arg?: ModelArg<Post>) {
    super(arg);
  }
}

@uses("drizzle")
@model()
class Tag extends BaseModel {
  @pk({ type: "String" })
  id!: string;

  constructor(arg?: ModelArg<Tag>) {
    super(arg);
  }
}

@uses("drizzle")
@model()
class User extends BaseModel {
  @pk({ type: "String" })
  id!: string;

  @required()
  @column("name")
  name!: string;

  @oneToOne(() => Profile, { delete: Cascade.CASCADE })
  profile!: Profile;

  @oneToMany(() => Post)
  posts!: Post[];

  constructor(arg?: ModelArg<User>) {
    super(arg);
  }
}
```

What the adapter does with them (see the full mapping table in the [Description](#description)):

- `@oneToOne` / `@manyToOne`: the relation property becomes the foreign-key column; if the property is not also a `@column`, an FK column is generated, wired to the target table's primary key, and honoured by `adapter.index()` DDL. `Cascade` options map to `ON DELETE`/`ON UPDATE` actions.
- `@manyToMany`: a join table (`<table>_<prop>_join`) with a composite primary key over `source_id`/`target_id` and foreign keys to both sides.
- `@oneToMany`: the inverse side; the foreign key lives on the owning `@manyToOne` side and no extra column is emitted.

#### 10) Observe changes

Description: subscribe to `CREATE`/`UPDATE`/`DELETE` events raised by operations performed through the adapter. Drizzle drivers expose no change feed, so notifications come from the adapter's dispatch layer only.

```ts
import type { Observer } from "@decaf-ts/core";
import { OperationKeys } from "@decaf-ts/db-decorators";

const observer: Observer = {
  async refresh(table: string, operation: OperationKeys | string, ids: string[]) {
    if (operation.toString() === OperationKeys.DELETE.toString()) {
      console.log(`Deleted from ${table}:`, ids);
    }
  },
};

await repo.observe(observer);
// ... later
await repo.unObserve(observer);
```

#### Testing against SQLite, MySQL and PostgreSQL

- SQLite tests run in-memory through `better-sqlite3` and need no external service.
- MySQL integration tests use the provided `docker/docker-compose.yml` (MySQL `8.4`, pinned). Bring the service up with `npm run docker:up` (or `npm run prepare-it-tests`) and tear it down with `npm run docker:down`; both delegate to `docker compose --project-directory docker`. Defaults live in `docker/.env` (`MYSQL_PORT=3306`, database/user/password `alfred`/`alfred`/`password`) and can be overridden through the `MYSQL_*` environment variables; the container healthchecks with `mysqladmin ping` before tests start. Point `MYSQL_URI` at the exposed port, e.g. `mysql://alfred:password@localhost:3306/alfred`.
- PostgreSQL integration tests are wired through `POSTGRES_URI` via the test helpers (`createPostgresAdapter`/`hasPostgres` in `tests/helpers/drizzleSetup.ts`). There is no bundled compose service — point `POSTGRES_URI` at any reachable server, e.g. `postgres://user:password@localhost:5432/db`. Suites skip with an explicit coverage report when the variable is unset, are serialised across Jest workers by a lock directory under the OS temp dir, and use an explicit per-test timeout to absorb the lock wait.

See the [Testing](./workdocs/tutorials/Testing.md) tutorial for the complete test matrix and harness details.

#### Coding Principles

- group similar functionality in folders;
- one class per file;
- one interface per file (unless used only as a type);
- group types in a `types.ts` per folder;
- group constants/enums in a `constants.ts` per folder;
- import from the specific file, never a folder/index (except dependencies on other packages);
- prefer established design patterns (factory, observer, strategy, builder, …).


### Related

[![Readme Card](https://github-readme-stats.vercel.app/api/pin/?username=decaf-ts&repo=for-drizzle)](https://github.com/decaf-ts/for-drizzle)
[![decaf-ts](https://github-readme-stats.vercel.app/api/pin/?username=decaf-ts&repo=decaf-ts)](https://github.com/decaf-ts/decaf-ts)
[![core](https://github-readme-stats.vercel.app/api/pin/?username=decaf-ts&repo=core)](https://github.com/decaf-ts/core)
[![decorator-validation](https://github-readme-stats.vercel.app/api/pin/?username=decaf-ts&repo=decorator-validation)](https://github.com/decaf-ts/decorator-validation)
[![db-decorators](https://github-readme-stats.vercel.app/api/pin/?username=decaf-ts&repo=db-decorators)](https://github.com/decaf-ts/db-decorators)
[![for-typeorm](https://github-readme-stats.vercel.app/api/pin/?username=decaf-ts&repo=for-typeorm)](https://github.com/decaf-ts/for-typeorm)
[![for-nano](https://github-readme-stats.vercel.app/api/pin/?username=decaf-ts&repo=for-nano)](https://github.com/decaf-ts/for-nano)


### Social

[![LinkedIn](https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/TiagoVenceslau/)




#### Languages

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![NodeJS](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![ShellScript](https://img.shields.io/badge/Shell_Script-121011?style=for-the-badge&logo=gnu-bash&logoColor=white)

## Getting help

If you have bug reports, questions or suggestions, please [create a new issue](https://github.com/decaf-ts/for-drizzle/issues/new/choose).

## Contributing

I am grateful for any contributions made to this project. Please read [this](./workdocs/98-Contributing.md) to get started.

## Supporting

The first and easiest way you can support it is by [Contributing](./workdocs/tutorials/Contributing.md). Even just finding a typo in the documentation is important.

Financial support is always welcome and helps keep both me and the project alive and healthy.

So if you can, if this project in any way. either by learning something or simply by helping you save precious time, please consider donating.

## License

This project is released under the [MIT License](./LICENSE.md).

By developers, for developers...