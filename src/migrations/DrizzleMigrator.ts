import { Model } from "@decaf-ts/decorator-validation";
import { Constructor } from "@decaf-ts/decoration";
import { InternalError } from "@decaf-ts/db-decorators";
import { generateDDL } from "../indexes/generator";
import { DrizzleConfig } from "../types";

/**
 * @description Migration helper for the Drizzle adapter
 * @summary Bridges decaf model decoration and Drizzle's migration mechanisms.
 * `migrate` runs Drizzle's programmatic migrator (the same SQL files
 * `drizzle-kit` generates), while `generate` emits the equivalent DDL for a set of
 * decaf models so it can be reviewed and versioned.
 * @class DrizzleMigrator
 * @memberOf module:for-drizzle
 */
export class DrizzleMigrator {
  /**
   * @description Runs Drizzle's programmatic migrator
   * @summary Applies the SQL migrations found in `migrationsFolder` using the
   * `better-sqlite3`, `mysql2` or `node-postgres` migrator depending on the
   * configured dialect.
   * The folder is expected to follow Drizzle's standard migration layout
   * (as produced by `drizzle-kit generate`).
   * @param {DrizzleConfig} config The Drizzle connection configuration
   * @param {string} migrationsFolder Path to the migrations folder
   * @return {Promise<void>} Resolves when the migrations have been applied
   * @function migrate
   * @memberOf module:for-drizzle
   */
  static async migrate(
    config: DrizzleConfig,
    migrationsFolder: string
  ): Promise<void> {
    if (!migrationsFolder)
      throw new InternalError(
        "A migrations folder is required to run Drizzle migrations"
      );
    if (config.dialect === "sqlite") {
      const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
      migrate(config.db as any, { migrationsFolder });
      return;
    }
    if (config.dialect === "postgres") {
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      await migrate(config.db as any, { migrationsFolder });
      return;
    }
    const { migrate } = await import("drizzle-orm/mysql2/migrator");
    await migrate(config.db as any, { migrationsFolder });
  }

  /**
   * @description Generates SQL DDL for a set of decaf models
   * @summary Translates each model's decoration into dialect-specific DDL and
   * writes one `.sql` file per model into `outFolder`. The generated files can be
   * placed in a Drizzle migrations folder or applied directly with the adapter's
   * `index()` method.
   * @template M The model type
   * @param {DrizzleConfig} config The Drizzle connection configuration
   * @param {Array.<Constructor<M>>} models The models to generate DDL for
   * @param {string} outFolder The folder to write the SQL files to
   * @return {Promise<string[]>} The generated file paths
   * @function generate
   * @memberOf module:for-drizzle
   */
  static async generate<M extends Model>(
    config: DrizzleConfig,
    models: Constructor<M>[],
    outFolder: string
  ): Promise<string[]> {
    if (!outFolder)
      throw new InternalError(
        "An output folder is required to generate migrations"
      );
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.mkdirSync(outFolder, { recursive: true });
    const files: string[] = [];
    for (const model of models) {
      const statements = generateDDL(model, config.dialect);
      const tableName = Model.tableName(model).replace(/^\?\?/, "");
      const file = path.join(outFolder, `${tableName}.sql`);
      fs.writeFileSync(file, statements.join(";\n") + ";\n");
      files.push(file);
    }
    return files;
  }
}
