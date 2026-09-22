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
