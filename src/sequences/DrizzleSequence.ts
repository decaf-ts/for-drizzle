import { Sequence, SequenceOptions } from "@decaf-ts/core";
import type { Context } from "@decaf-ts/core";
import { DrizzleAdapter } from "../DrizzleAdapter";

/**
 * @description Sequence generator for the Drizzle adapter
 * @summary Extends the core `Sequence` implementation, which persists sequence
 * counters through the adapter's own repository. No Drizzle-specific storage is
 * required because the base implementation is storage-agnostic and uses the adapter
 * to read/update the backing `SequenceModel` row.
 * @class DrizzleSequence
 * @memberOf module:for-drizzle
 */
export class DrizzleSequence extends Sequence<DrizzleAdapter> {
  constructor(
    options: SequenceOptions,
    adapter: DrizzleAdapter,
    overrides: any = {}
  ) {
    super(options, adapter, overrides);
  }

  /**
   * @description Produces the next sequence value
   * @summary Delegates the counter persistence to the core `Sequence` and parses
   * the raw stored value back to its declared type (`string`, `number` or
   * `bigint`) so callers receive the same scalar shape as the other adapters.
   * @param {number | undefined} count How many increments to apply in one call
   * @param {Context<any>} context The operation context
   * @return {Promise<string | number | bigint>} The next sequence value
   */
  protected override async increment(
    count: number | undefined,
    context: Context<any>
  ): Promise<string | number | bigint> {
    const next = await super.increment(count, context);
    return this.parse(next);
  }
}
