// Single-PC data migrations (#364): the registry the upgrade tool runs.
//
// DATA_VERSION is the data version this release's API reads and writes. It
// must equal contracts' SINGLE_PC_DATA_VERSION (upgrade.test.mjs pins it):
// the API refuses to start on any other one.
//
// Rules for a migration (every future schema change that needs one):
// - `id` is unique and never reused; `to` is `from + 1`; the registry is
//   ordered and contiguous up to DATA_VERSION.
// - `up(db, { log })` gets the app database (MongoDB driver Db, root
//   credentials) with the API stopped. It must be idempotent: an
//   interrupted run is re-run from the start of that migration, so it must
//   converge on re-run (filters that skip done documents, upserts,
//   `$set` of computed values), never "apply twice".
// - It must not need the network, a developer checkout, ts-node or
//   anything outside the release (it runs from release\tools\upgrade with
//   the release's node.exe and the API's own node_modules).
// - It declares `changesData: true` unless it only builds indexes or
//   reads; the upgrade's rollback then needs the pre-upgrade backup.
//
// The cloud's legacy migrations (README: migrate:categories,
// migrate:stock-ledger, migrate:decode-entities) are not part of this
// registry. Every single-PC database was created at data version 1 by
// #360 provisioning and the current API, so none of their legacy inputs
// (category enum strings, unmigrated stock history, entity-encoded text)
// can exist there; running them on live data is exactly what #364 forbids.
// LEGACY_NOT_APPLICABLE records that decision for the release manifest.

export const DATA_VERSION = 1;
/** The oldest data version this release can upgrade from. */
export const MIN_UPGRADE_FROM = 1;

export const LEGACY_NOT_APPLICABLE = Object.freeze([
    'migrate:categories',
    'migrate:stock-ledger',
    'migrate:decode-entities',
]);

/** Ordered: `from` → `to`. Empty while the data version is 1. */
export const MIGRATIONS = Object.freeze([]);

/** Throws if the registry is not ordered, contiguous and unique. */
export function validateRegistry(
    migrations,
    dataVersion,
    minFrom = MIN_UPGRADE_FROM,
) {
    const ids = new Set();
    let expect = minFrom;
    for (const m of migrations) {
        if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(m.id))
            throw new Error(`Migration id ${String(m.id)} is not valid.`);
        if (ids.has(m.id))
            throw new Error(`Migration ${m.id} is listed twice.`);
        ids.add(m.id);
        if (m.from !== expect || m.to !== m.from + 1)
            throw new Error(
                `Migration ${m.id} goes ${m.from} → ${m.to}; expected ${expect} → ${expect + 1}.`,
            );
        if (typeof m.up !== 'function')
            throw new Error(`Migration ${m.id} has no up().`);
        expect = m.to;
    }
    if (expect !== dataVersion)
        throw new Error(
            `Migrations end at data version ${expect}, the release declares ${dataVersion}.`,
        );
}

/** The migrations taking `from` to `to`, in order. */
export function pendingMigrations(migrations, from, to) {
    return migrations.filter((m) => m.from >= from && m.to <= to);
}

/** What the release manifest records about data compatibility. */
export function dataCompatibility(
    migrations = MIGRATIONS,
    dataVersion = DATA_VERSION,
    minFrom = MIN_UPGRADE_FROM,
) {
    validateRegistry(migrations, dataVersion, minFrom);
    return {
        dataVersion,
        minUpgradeFromDataVersion: minFrom,
        migrations: migrations.map((m) => ({
            id: m.id,
            from: m.from,
            to: m.to,
            changesData: m.changesData !== false,
        })),
        legacyMigrationsNotApplicable: [...LEGACY_NOT_APPLICABLE],
    };
}
