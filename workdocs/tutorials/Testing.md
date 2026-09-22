# Testing

How `@decaf-ts/for-drizzle` is tested: in-process SQLite for unit work, a live MySQL service via docker-compose, and a `POSTGRES_URI`-configured PostgreSQL backend for integration proof.

## Test scripts

| Script | What it runs |
| --- | --- |
| `npm run test:unit` | Jest suites under `tests/unit` |
| `npm run test:integration` | Jest suites under `tests/integration` |
| `npm run test` | The full suite, in-band, with coverage and open-handle detection |
| `npm run test:all` | Everything under `tests/` |
| `npm run coverage` | Coverage run configured from `workdocs/reports/jest.coverage.config.cjs`, reports into `workdocs/reports/` |

## Choosing what the tests import: `TEST_TARGET`

`tests/workspace-target.ts` resolves the module under test from the `TEST_TARGET` environment variable:

| `TEST_TARGET` | Imports from |
| --- | --- |
| `src` (default) | the TypeScript sources in `src/` |
| `lib` | the built CJS bundle (`lib/cjs/index.cjs`) |
| `dist` | the packaged bundle (`dist/`) |

This lets the same suites run against sources in development and against real build artifacts before publishing:

```bash
TEST_TARGET=lib npm run test:all
```

## SQLite (in-process)

SQLite tests use `better-sqlite3` with an in-memory database, so they need no external service:

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { DrizzleAdapter } from "@decaf-ts/for-drizzle";

const sqlite = new Database(":memory:");
const adapter = new DrizzleAdapter({ dialect: "sqlite", db: drizzle(sqlite), client: sqlite });
await adapter.initialize();
await adapter.index(/* ...models */);
```

## MySQL (live service via docker-compose)

The MySQL integration harness is `docker/docker-compose.yml` — a single `mysql_db` service mirroring the compose setup of the other decaf SQL adapters:

- image `mysql:8.4` (pinned tag);
- host port `${MYSQL_PORT:-3306}` → container `3306`;
- defaults from `docker/.env`: `MYSQL_DATABASE=alfred`, `MYSQL_USER=alfred`, `MYSQL_PASSWORD=password`, `MYSQL_ROOT_PASSWORD=password`;
- a `mysqladmin ping` healthcheck (`interval 5s`, `timeout 10s`, `retries 10`, `start_period 30s`) so dependents only start against a ready server;
- a dedicated `mysql_network` and a named `mysql` data volume;
- credentials, version and port are all overridable through the `MYSQL_*` environment variables.

Bring it up and down with the npm wrappers (both delegate to `docker compose --project-directory docker`):

```bash
npm run docker:up           # compose up -d --wait (blocks until healthy)
npm run docker:down         # compose down -v (removes the data volume)
npm run prepare-it-tests    # alias used before integration runs
```

Then point the tests at the exposed server:

```bash
MYSQL_URI=mysql://alfred:password@localhost:3306/alfred npm run test:integration
```

Connection failures are normalised by the adapter into decaf's error hierarchy (e.g. `ConnectionError` for `ECONNREFUSED`/`PROTOCOL_CONNECTION_LOST`), so integration suites can assert on decaf errors rather than driver specifics.

## PostgreSQL (`POSTGRES_URI`)

PostgreSQL suites are wired through the test helpers in `tests/helpers/drizzleSetup.ts`:

- `postgresUri()` reads `POSTGRES_URI`; `hasPostgres()` reports whether the backend is configured; `createPostgresAdapter(models)` builds a live `DrizzleAdapter` (`dialect: "postgres"`, `drizzle-orm/node-postgres` over a `pg` `Pool`) after dropping and recreating the `public` schema.
- There is **no bundled compose service** for PostgreSQL — point `POSTGRES_URI` at any reachable server, e.g. `postgres://user:password@localhost:5432/db`.
- Suites skip with an explicit coverage report when `POSTGRES_URI` is unset; a missing backend is never silently treated as passing.
- Like MySQL, PostgreSQL suites share one database and are serialised across Jest workers by an atomic lock directory under the OS temp dir (`POSTGRES_LOCK_DIR`; stale after 30 minutes, wait up to 20 minutes). Suites opt into `POSTGRES_TEST_TIMEOUT_MS` (20 minutes) so the lock wait is never mistaken for a hang.
- `forEachDialect(name, fn)` runs a test body once per configured dialect — SQLite always, MySQL when `MYSQL_URI` is set, PostgreSQL when `POSTGRES_URI` is set — and emits an explicit report item naming each unset variable.

```bash
POSTGRES_URI=postgres://user:password@localhost:5432/db npm run test:integration
```

## Current coverage state

`tests/integration` holds the adapter-parity suites (CRUD, query/pagination, ordering, relations, indexes, sequences/version, timestamps, migrations, dispatch, multi-adapter, task engine, security regressions, plus the dialect suites `dialects.mysql.test.ts` and `dialects.postgres.test.ts`). They run against SQLite in every run; MySQL runs when `MYSQL_URI` is set and PostgreSQL when `POSTGRES_URI` is set, with explicit coverage reports for missing backends.

## See also

- [Setup and Installation](./Setup%20and%20Installation.md)
- [Migrations](./Migrations.md) — bootstrapping schemas for test databases
