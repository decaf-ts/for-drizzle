# Migrations

How schema creation and evolution work in `@decaf-ts/for-drizzle`.

The board requirement was migration parity with `for-typeorm`. The two adapters expose their schema-evolution machinery differently, and this page states exactly what `for-drizzle` implements today:

- **for-typeorm** wires schema evolution into decaf's `@migration`/`MigrationService` lifecycle (versioned migration classes, flavour-scoped handlers, `migrateAdapters` orchestration).
- **for-drizzle** implements its migrations through **Drizzle's own migration mechanisms**, exposed as the `DrizzleMigrator` helper, plus the adapter's `index()` DDL application. decaf's `MigrationService` orchestration is not wired for the `drizzle` flavour yet — use the Drizzle-native flow below for versioned schema changes.

## Immediate schema materialisation: `adapter.index()`

For quick starts, tests and prototypes, the adapter can translate a model and apply its DDL directly. `index()` emits `CREATE TABLE IF NOT EXISTS` (with primary keys, nullability, unique and generated/autoincrement constraints) followed by `CREATE INDEX` statements for every declared decaf index, then creates join tables for `@manyToMany` relations:

```ts
const adapter = new DrizzleAdapter({ dialect: "sqlite", db, client: sqlite });
await adapter.initialize();

await adapter.index(User, Post, Tag); // tables + indexes + join tables
```

Notes:

- decaf's `??sequence` bookkeeping table (used by generated primary keys/sequences) is included automatically, renamed to `drizzle_sequence`.
- SQLite and PostgreSQL statements are `CREATE ... IF NOT EXISTS`; MySQL emits plain `CREATE INDEX` (matching each dialect's support), so on MySQL the method is idempotent per fresh schema but re-running table DDL stays safe via `IF NOT EXISTS`.
- Drizzle's own migration tooling remains the recommended production path; `index()` mirrors the parity behaviour of the other decaf SQL adapters.

## Versioned migrations: `DrizzleMigrator`

### `DrizzleMigrator.migrate(config, migrationsFolder)`

Runs Drizzle's programmatic migrator against a migrations folder in Drizzle's standard layout (the SQL files `drizzle-kit generate` produces), dispatching to the dialect-specific migrator (`drizzle-orm/better-sqlite3/migrator`, `drizzle-orm/mysql2/migrator` or `drizzle-orm/node-postgres/migrator`):

```ts
import { DrizzleMigrator } from "@decaf-ts/for-drizzle";

await DrizzleMigrator.migrate(
  { dialect: "sqlite", db },   // the same config you gave the adapter
  "./drizzle"                  // drizzle-kit output folder
);
```

A missing migrations folder throws a decaf `InternalError`.

### `DrizzleMigrator.generate(config, models, outFolder)`

Translates each decaf model's decoration into dialect-specific DDL and writes **one `.sql` file per model** into the output folder (filename = table name). The generated files can be reviewed, versioned in your repository, handed to `drizzle-kit`-managed migration folders, or applied directly with `adapter.index()`:

```ts
const files = await DrizzleMigrator.generate(
  { dialect: "mysql", db },
  [User, Post, Tag],
  "./drizzle/generated"
);
// ["./drizzle/generated/users.sql", "./drizzle/generated/posts.sql", ...]
```

### Typical workflow with `drizzle-kit`

1. Keep your models as the single source of truth.
2. Use `DrizzleMigrator.generate` (or `drizzle-kit generate` against your own hand-written Drizzle schemas) to produce the migration SQL.
3. Review and commit the SQL files.
4. Apply them at start-up or in your deployment pipeline with `DrizzleMigrator.migrate`.
5. For ad-hoc schema bootstrapping in tests, call `adapter.index(...)` instead.

## What about decaf's `@migration` lifecycle?

decaf's `MigrationService`, the `@migration` decorator and flavour-scoped version handlers are documented for the adapters that integrate them (see the for-nano and for-typeorm how-tos). `for-drizzle` does not register drizzle-flavoured migration handlers yet; until that wiring exists, treat the Drizzle-native flow above as the supported migration path for this adapter.

## See also

- [Model Decoration and Relations](./Model%20Decoration%20and%20Relations.md) — the decoration metadata that drives the generated DDL
- [Testing](./Testing.md) — bootstrapping schemas in the sqlite/mysql/postgres test backends
