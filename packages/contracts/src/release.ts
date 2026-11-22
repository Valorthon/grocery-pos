/**
 * Release compatibility (#364). Every release that changes the request or
 * response contract incompatibly bumps `WIRE_VERSION`; every release that
 * needs a data migration on the single-PC edition bumps
 * `SINGLE_PC_DATA_VERSION` and registers the migration in
 * `packaging/single-pc/upgrade/migrations.mjs` (its `DATA_VERSION` must
 * equal this one; a test pins it).
 */

/**
 * The client/API wire contract generation. A single-PC client sends it in
 * `WIRE_VERSION_HEADER`; the single-PC API refuses a different one with
 * 409 `CLIENT_OUTDATED` before reading the body, so a browser tab still
 * running the previous release's code never submits an old-shape request.
 */
export const WIRE_VERSION = 1;
export const WIRE_VERSION_HEADER = 'x-wire-version';

/**
 * The single-PC database's data version this release reads and writes.
 * The single-PC API refuses to start against any other one (an absent
 * marker is version 1, the #360 baseline).
 */
export const SINGLE_PC_DATA_VERSION = 2;

/** Collection (in the app database) holding the data-version marker. */
export const DATA_VERSION_COLLECTION = 'systemdataversion';
export const DATA_VERSION_ID = 'data';
