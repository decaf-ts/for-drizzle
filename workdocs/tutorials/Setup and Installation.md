# Setup and Installation

How to get `@decaf-ts/for-drizzle` running against SQLite, MySQL and PostgreSQL.

## Install the package

```bash
npm i @decaf-ts/for-drizzle
```

The adapter is built on top of [Drizzle ORM](https://orm.drizzle.team/) and the decaf data stack. The peer pieces you normally pair it with:

```bash
npm i @decaf-ts/core @decaf-ts/db-decorators @decaf-ts/decorator-validation drizzle-orm
```

## Choose and install a driver

The adapter does **not** create connections. You construct the Drizzle database instance yourself and hand it over, together with the dialect it was built for — so you install the driver that matches your backend:

| Backend | Driver | Drizzle entry point | Dialect value |
| --- | --- | --- | --- |
| SQLite | `better-sqlite3` | `drizzle-orm/better-sqlite3` | `"sqlite"` |
| MySQL | `mysql2` | `drizzle-orm/mysql2` | `"mysql"` |
| PostgreSQL | `pg` | `drizzle-orm/node-postgres` | `"postgres"` |

```bash
npm i better-sqlite3   # SQLite
npm i mysql2           # MySQL
npm i pg               # PostgreSQL
```

## SQLite (zero infrastructure)

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { DrizzleAdapter } from "@decaf-ts/for-drizzle";

const sqlite = new Database(":memory:"); // or a file path
const db = drizzle(sqlite);

const adapter = new DrizzleAdapter({ dialect: "sqlite", db, client: sqlite });
await adapter.initialize();
```

An in-memory database starts empty; see [Migrations](./Migrations.md) or the adapter's `index()` method to materialise tables before use.

## MySQL

Local development and integration testing can use the bundled compose harness (see [Testing](./Testing.md)); for a real server just point `mysql2` at it:

```ts
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { DrizzleAdapter } from "@decaf-ts/for-drizzle";

const pool = mysql.createPool({
  uri: process.env.MYSQL_URI, // mysql://user:password@host:port/database
});
const db = drizzle(pool);
const adapter = new DrizzleAdapter({ dialect: "mysql", db, client: pool });
await adapter.initialize();
```

## PostgreSQL

For a real server (or the `POSTGRES_URI`-configured backend used by the integration suites, see [Testing](./Testing.md)):

```ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { DrizzleAdapter } from "@decaf-ts/for-drizzle";

const pool = new Pool({
  connectionString: process.env.POSTGRES_URI, // postgres://user:password@host:port/database
});
const db = drizzle(pool);
const adapter = new DrizzleAdapter({ dialect: "postgres", db, client: pool });
await adapter.initialize();
```

## Registering the flavour

Importing anything from `@decaf-ts/for-drizzle` registers the `drizzle` flavour with decaf's adapter registry and runs the adapter decoration wiring. From that point on, `Repository.forModel(Model)` resolves a `DrizzleRepository` for models decorated with `@uses("drizzle")`:

```ts
import "@decaf-ts/for-drizzle"; // registers the flavour

import { Repository, uses, pk } from "@decaf-ts/core";
import { model } from "@decaf-ts/decorator-validation";

@uses("drizzle")
@model()
class UserModel extends BaseModel {
  @pk({ type: "String" })
  id!: string;
}

const repo = Repository.forModel(UserModel); // DrizzleRepository
```

## Next steps

- [Model Decoration and Relations](./Model%20Decoration%20and%20Relations.md) — declaring models the adapter can translate.
- [Migrations](./Migrations.md) — creating the schema.
- [Testing](./Testing.md) — the sqlite/mysql/postgres test backends and the docker-compose harness.
