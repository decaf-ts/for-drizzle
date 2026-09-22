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
