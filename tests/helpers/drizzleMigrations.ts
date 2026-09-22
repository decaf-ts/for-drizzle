import { Adapter } from "@decaf-ts/core";
import type { DrizzleTestHandle } from "./drizzleSetup";

/**
 * Binds a live Drizzle test adapter to a custom migration flavour so
 * `@migration(reference, version, flavour)` classes can resolve it through
 * `Adapter.get(flavour)`.
 *
 * `MigrationService.migrateAdapters` selects the per-adapter execution plan by
 * `adapter.alias`, so the adapter's alias is rewritten to the flavour as well.
 * The returned disposer restores the adapter's original identity and removes the
 * flavour registration; always call it in a `finally` so the process-wide adapter
 * cache is not polluted across suites.
 *
 * @param handle The live Drizzle test handle
 * @param flavour The custom migration flavour to register the adapter under
 * @return A disposer that restores the adapter identity and unregisters the flavour
 */
export function useMigrationFlavour(
  handle: DrizzleTestHandle,
  flavour: string
): () => void {
  const adapter = handle.adapter as any;
  const previousAlias = adapter._alias;
  const previousFlavour = adapter.flavour;
  adapter._alias = flavour;
  adapter.flavour = flavour;
  (Adapter as any)._cache[flavour] = adapter;
  return () => {
    if ((Adapter as any)._cache[flavour] === adapter)
      delete (Adapter as any)._cache[flavour];
    adapter._alias = previousAlias;
    adapter.flavour = previousFlavour;
  };
}
