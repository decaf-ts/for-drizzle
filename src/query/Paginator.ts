import { Model } from "@decaf-ts/decorator-validation";
import { Constructor } from "@decaf-ts/decoration";
import {
  MaybeContextualArg,
  Paginator,
  PreparedStatement,
} from "@decaf-ts/core";
import { SQL, sql } from "drizzle-orm";
import { DrizzleAdapter } from "../DrizzleAdapter";
import { DrizzleQuery } from "../types";


/**
 * @description Paginator for the Drizzle adapter
 * @summary Executes a Drizzle `SQL` query with `limit`/`offset` pagination.
 * Because Drizzle statements are plain SQL objects, pagination is implemented by
 * wrapping the query in a count sub-select and then appending limit/offset clauses.
 * @template M The model type
 * @class DrizzlePaginator
 * @memberOf module:for-drizzle
 */
export class DrizzlePaginator<M extends Model> extends Paginator<
  M,
  M[],
  DrizzleQuery
> {
  constructor(
    adapter: DrizzleAdapter,
    query: DrizzleQuery | PreparedStatement<M>,
    size: number,
    clazz: Constructor<M>
  ) {
    super(adapter, query, size, clazz);
  }

  /**
   * @description Applies the page size to the raw statement
   * @summary Appends a `limit` clause matching the configured page size.
   * @param {DrizzleQuery} rawStatement The base query
   * @return {DrizzleQuery} The limited query
   */
  protected prepare(rawStatement: DrizzleQuery): DrizzleQuery {
    return sql`${rawStatement} limit ${this.size}`;
  }

  /**
   * @description Retrieves a specific page of results
   * @summary Counts the total matching records on first call, then fetches the
   * requested page by appending `limit`/`offset` and reverting each row to a model.
   * @param {number} [page=1] The 1-based page number
   * @return {Promise<M[]>} The page of models
   */
  override async page(
    page: number = 1,
    ...args: MaybeContextualArg<any>
  ): Promise<M[]> {
    const { ctx, ctxArgs } = this.adapter["logCtx"](args, this.page);
    if (this.isPreparedStatement()) return this.pagePrepared(page, ...ctxArgs);

    const base = this.query as SQL;
    if (!this._recordCount || !this._totalPages) {
      this._totalPages = this._recordCount = 0;
      const countQuery = sql`select count(*) as ${sql.identifier(
        "count"
      )} from (${base}) as ${sql.identifier("drizzle_page")}`;
      const countRows: any = await this.adapter.raw<any, true>(
        countQuery,
        true,
        ...ctxArgs
      );
      const countRow = Array.isArray(countRows) ? countRows[0] : countRows;
      this._recordCount = Number(countRow?.count ?? 0);
      if (this._recordCount === 0) return [];
      this._totalPages = Math.ceil(this._recordCount / this.size);
    }

    page = this.validatePage(page);
    const offset = (page - 1) * this.size;
    const statement = sql`${base} limit ${this.size} offset ${offset}`;
    const results: any = await this.adapter.raw<any, true>(
      statement,
      true,
      ...ctxArgs
    );
    const rows = (Array.isArray(results) ? results : results?.data) ?? [];
    this._currentPage = page;
    const adapter = this.adapter as DrizzleAdapter;
    const pkDbName = adapter.pkColumnName(this.clazz);
    this._bookmark = rows.length ? rows[rows.length - 1][pkDbName] : undefined;
    return rows.map((row: any) => adapter.revertRow(row, this.clazz, ctx));
  }
}
