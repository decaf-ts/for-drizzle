import { ContextLock } from "@decaf-ts/core";
import { sql } from "drizzle-orm";
import { DrizzleAdapter } from "./DrizzleAdapter";

/**
 * @description Transaction lock for the Drizzle adapter
 * @summary Extends the core `ContextLock` with native `BEGIN`/`COMMIT`/`ROLLBACK`
 * statements. Native transactions are only issued for the single-connection SQLite
 * dialect; MySQL uses a pooled connection where a bare `BEGIN` would not bind the
 * subsequent statements to the same connection, so there the base semaphore gating is
 * used exclusively.
 * @class DrizzleContextLock
 * @memberOf module:for-drizzle
 */
export class DrizzleContextLock extends ContextLock<DrizzleAdapter> {
  private inTransaction = false;

  private get nativeTransactions(): boolean {
    return this.adapter.config.dialect === "sqlite";
  }

  private async statement(query: string): Promise<void> {
    const db: any = this.adapter.config.db;
    if (typeof db.run === "function") {
      db.run(sql.raw(query));
      return;
    }
    await db.execute(sql.raw(query));
  }

  /**
   * @description Starts a transaction
   * @summary Applies the base concurrency gating and, for SQLite, issues a
   * native `BEGIN` statement.
   * @param {Context<any>} context The transaction context
   */
  override async begin(context: any): Promise<void> {
    await super.begin(context);
    if (this.nativeTransactions && !this.inTransaction) {
      await this.statement("begin");
      this.inTransaction = true;
    }
  }

  /**
   * @description Commits a transaction
   * @summary Applies the base release and, for SQLite, issues a native `COMMIT`.
   * @param {Context<any>} context The transaction context
   */
  override async commit(context: any): Promise<void> {
    try {
      if (this.nativeTransactions && this.inTransaction) {
        await this.statement("commit");
        this.inTransaction = false;
      }
    } finally {
      await super.commit(context);
    }
  }

  /**
   * @description Rolls back a transaction
   * @summary Applies the base release and, for SQLite, issues a native
   * `ROLLBACK` statement.
   * @param {Error} err The error that triggered the rollback
   * @param {Context<any>} context The transaction context
   */
  override async rollback(err: Error, context: any): Promise<void> {
    try {
      if (this.nativeTransactions && this.inTransaction) {
        await this.statement("rollback");
        this.inTransaction = false;
      }
    } finally {
      await super.rollback(err, context);
    }
  }
}
