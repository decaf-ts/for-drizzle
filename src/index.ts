import { Adapter } from "@decaf-ts/core";
import { Metadata } from "@decaf-ts/decoration";
import { DrizzleAdapter } from "./DrizzleAdapter";
import { DrizzleFlavour } from "./constants";

// Registers the Drizzle flavour as the current adapter flavour and
// makes the adapter discoverable through decaf's flavour registry.
Adapter.setCurrent(DrizzleFlavour);
DrizzleAdapter.decoration();

export * from "./constants";
export * from "./types";
export * from "./errors";
export * from "./schema";
export * from "./query";
export * from "./indexes";
export * from "./migrations";
export * from "./sequences";
export * from "./DrizzleContextLock";
export * from "./DrizzleAdapter";

/**
 * @description Package version identifier
 * @summary Stores the current package version string for the for-drizzle module.
 * @const VERSION
 * @memberOf module:for-drizzle
 */
export const VERSION = "##VERSION##";

/**
 * @description Represents the current commit hash of the module build
 * @summary Stores the current git commit hash for the package. The build replaces
 * the placeholder with the actual commit hash at publish time.
 * @const COMMIT
 * @memberOf module:for-drizzle
 */
export const COMMIT = "##COMMIT##";

/**
 * @description Represents the full version string of the module
 * @summary Stores the semver version and commit hash for the package. The build
 * replaces the placeholder with the actual `<version>-<commit>` value at publish time.
 * @const FULL_VERSION
 * @memberOf module:for-drizzle
 */
export const FULL_VERSION = "##FULL_VERSION##";

/**
 * @description Package name identifier
 * @summary Stores the package name string for the for-drizzle module.
 * @const PACKAGE_NAME
 * @memberOf module:for-drizzle
 */
export const PACKAGE_NAME = "##PACKAGE##";

Metadata.registerLibrary(PACKAGE_NAME, VERSION);
