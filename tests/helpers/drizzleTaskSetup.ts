import { PersistenceKeys } from "@decaf-ts/core";
import { onCreate, onCreateUpdate } from "@decaf-ts/db-decorators";
import { Decoration, propMetadata } from "@decaf-ts/decoration";
import { type Model } from "@decaf-ts/decorator-validation";
import { DrizzleFlavour } from "../../src";

/**
 * Test-only ownership handler for the Drizzle flavour.
 *
 * `src/DrizzleAdapter.ts` registers real `createdBy`/`updatedBy` handlers in its
 * `decoration()` override; those handlers require a `user` in the operation
 * context and throw `UnsupportedError` otherwise (unlike `for-nano`, the Drizzle
 * adapter has no connection-user default). The core `TaskEngine` issues several
 * internal repository updates without a context user, so the task suites register
 * this lenient Drizzle-flavoured handler to keep those internal writes working.
 *
 * It is a test-harness compensation only: `adapter-alias-flavour-createdby.test.ts`
 * exercises the real adapter handler with a context user and must NOT call this.
 */
export async function createdByOnDrizzleCreateUpdate<
  M extends Model,
  R,
  V,
>(
  this: R,
  context: { get: (key: string) => unknown },
  data: V,
  key: keyof M,
  model: M
): Promise<void> {
  const user = (() => {
    try {
      return context.get("user");
    } catch {
      return "system";
    }
  })();
  model[key] = ((user as any)?.name ?? user ?? "system") as M[typeof key];
}

let registered = false;

/**
 * Registers the Drizzle-flavoured `createdBy`/`updatedBy` handlers. Call once
 * per test file before persisting models that use the ownership decorators.
 */
export function registerDrizzleOwnershipHandlers(): void {
  if (registered) return;
  registered = true;
  Decoration.flavouredAs(DrizzleFlavour)
    .for(PersistenceKeys.CREATED_BY)
    .define(
      onCreate(createdByOnDrizzleCreateUpdate as any),
      propMetadata(PersistenceKeys.CREATED_BY, {})
    )
    .apply();
  Decoration.flavouredAs(DrizzleFlavour)
    .for(PersistenceKeys.UPDATED_BY)
    .define(
      onCreateUpdate(createdByOnDrizzleCreateUpdate as any),
      propMetadata(PersistenceKeys.UPDATED_BY, {})
    )
    .apply();
}
