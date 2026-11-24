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
// - An optional `check(db)` (read-only) returns refusal strings; the
//   upgrade's preflight runs it for every pending migration, so data the
//   migration would refuse stops the upgrade before anything changes.
//
// The cloud's legacy migrations (README: migrate:categories,
// migrate:stock-ledger, migrate:decode-entities) are not part of this
// registry. Every single-PC database was created at data version 1 by
// #360 provisioning and the current API, so none of their legacy inputs
// (category enum strings, unmigrated stock history, entity-encoded text)
// can exist there; running them on live data is exactly what #364 forbids.
// LEGACY_NOT_APPLICABLE records that decision for the release manifest.

import { APP_DATABASE } from '../runtime/layout.mjs';

/** contracts DATA_VERSION_COLLECTION / DATA_VERSION_ID. */
export const DATA_VERSION_COLLECTION = 'systemdataversion';
export const DATA_VERSION_ID = 'data';
/** One record per applied migration, in the app database (a restore of
 *  the pre-upgrade backup takes it back with the data it describes). */
export const MIGRATION_COLLECTION = 'systemmigrations';

export const DATA_VERSION = 2;
/** The oldest data version this release can upgrade from. */
export const MIN_UPGRADE_FROM = 1;

export const LEGACY_NOT_APPLICABLE = Object.freeze([
    'migrate:categories',
    'migrate:stock-ledger',
    'migrate:decode-entities',
]);

/** contracts STRING_LIMITS.PRODUCT_NAME. */
export const PRODUCT_NAME_MAX = 50;

/**
 * #443: plans uppercasing every product name, as contracts'
 * `planProductNameUppercase` does (the release's tools import nothing
 * from the workspace). Pure; an already-uppercased set plans no updates.
 */
export function planProductNames(rows, maxLength = PRODUCT_NAME_MAX) {
    const byName = new Map();
    const updates = [];
    const tooLong = [];
    for (const { _id, name } of rows) {
        const to = String(name).trim().toUpperCase();
        byName.set(to, [...(byName.get(to) ?? []), String(_id)]);
        if (to.length > maxLength) tooLong.push({ id: String(_id), to });
        if (to !== name) updates.push({ _id, from: name, to });
    }
    const collisions = [...byName]
        .filter(([, ids]) => ids.length > 1)
        .map(([name, ids]) => ({ name, ids }));
    return { updates, collisions, tooLong };
}

function productNameRefusals(plan) {
    const out = [];
    if (plan.collisions.length)
        out.push(
            `Product names collide after uppercasing: ${plan.collisions
                .map((c) => `${c.name} (${c.ids.join(', ')})`)
                .join(
                    '; ',
                )}. Rename them in the current release before upgrading.`,
        );
    if (plan.tooLong.length)
        out.push(
            `Product names exceed ${PRODUCT_NAME_MAX} characters after uppercasing: ${plan.tooLong
                .map((t) => t.id)
                .join(
                    ', ',
                )}. Rename them in the current release before upgrading.`,
        );
    return out;
}

async function readProductNames(db) {
    return db
        .collection('products')
        .find({}, { projection: { name: 1 } })
        .toArray();
}

export const UPPERCASE_PRODUCT_NAMES = Object.freeze({
    id: 'uppercase-product-names',
    from: 1,
    to: 2,
    changesData: true,
    async check(db) {
        return productNameRefusals(
            planProductNames(await readProductNames(db)),
        );
    },
    async up(db, { log = () => {} } = {}) {
        const plan = planProductNames(await readProductNames(db));
        // Re-check of preflight's `check`. It can't fire in practice: the
        // API has been stopped since preflight, so no product can be renamed
        // in between. If it did, nothing is written, but the journal already
        // marks data as changed (onDataChange runs first), so the upgrade
        // stops as `needs-recovery`: rename and re-run, or restore the
        // pre-upgrade backup with upgrade-rollback.
        const refusals = productNameRefusals(plan);
        if (refusals.length) throw new Error(refusals.join(' '));
        // Each write filters on the old name, so a re-run skips done rows
        // and converges (the unique name index can't clash: no collisions).
        for (const u of plan.updates)
            await db
                .collection('products')
                .updateOne(
                    { _id: u._id, name: u.from },
                    { $set: { name: u.to } },
                );
        log(`migrate: uppercased ${plan.updates.length} product name(s)`);
    },
});

/** Ordered: `from` → `to`. */
export const MIGRATIONS = Object.freeze([UPPERCASE_PRODUCT_NAMES]);

/**
 * contracts PRODUCT_NAME_PATTERN (#483): letters (any script, combining
 * marks too), digits, spaces and `. , - & ' / ( ) %`.
 */
export const PRODUCT_NAME_PATTERN =
    /^(?:(?![\u180B-\u180F\uFE00-\uFE0F\u{E0100}-\u{E01EF}])[\p{L}\p{Mn}\p{Mc}0-9 .,&'/()%-])*$/u;

/** contracts normalizeProductName (#443, #483). */
export function normalizeProductName(name) {
    return String(name)
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/\u00A0/g, ' ')
        .trim()
        .toUpperCase();
}

const NAME_STEPS =
    "To fix each one in the current release: open Products, set Product status to All, search the barcode, choose Edit, rename it using only letters, numbers, spaces and . , - & ' / ( ) %, and save. Then run the upgrade again.";

/** Stored names invalid in their normalized form, active and archived. */
async function invalidProductNameRows(db) {
    const bad = (
        await db
            .collection('products')
            .find({}, { projection: { name: 1, EAN: 1, isActive: 1 } })
            .toArray()
    ).filter((r) => !PRODUCT_NAME_PATTERN.test(normalizeProductName(r.name)));
    return {
        active: bad.filter((r) => r.isActive !== false),
        archived: bad.filter((r) => r.isActive === false),
    };
}

// contracts describeInvalidProductName.
const describeRow = (r) =>
    `${r.EAN ?? '(no barcode)'} – ${String(r.name)}${r.isActive === false ? ' (archived)' : ''}`;

/**
 * #483: product names with emoji or other disallowed characters. Not a
 * migration (no data version bump): nothing is rewritten, the owner
 * renames them in the current release first. Active ones refuse the
 * upgrade; archived ones only warn (owner decision 2026-11-24).
 */
export const PRODUCT_NAME_CHARACTERS = Object.freeze({
    id: 'product-name-characters',
    async check(db) {
        const { active } = await invalidProductNameRows(db);
        if (active.length === 0) return [];
        return [
            `Product names use characters that are no longer allowed: ${active
                .map(describeRow)
                .join('; ')}. ${NAME_STEPS}`,
        ];
    },
    async warnings(db) {
        const { archived } = await invalidProductNameRows(db);
        if (archived.length === 0) return [];
        return [
            `warning: archived product names use characters that are no longer allowed (the upgrade continues): ${archived
                .map(describeRow)
                .join('; ')}. ${NAME_STEPS}`,
        ];
    },
});

/**
 * Read-only checks the preflight runs on every upgrade, whatever the data
 * version: rules a release enforces without a migration.
 */
export const DATA_CHECKS = Object.freeze([PRODUCT_NAME_CHARACTERS]);

/**
 * Refusals from the pending migrations' read-only `check(db)`, then from
 * every `checks` entry (DATA_CHECKS by default).
 */
export async function migrationRefusals(
    db,
    migrations,
    from,
    to,
    checks = DATA_CHECKS,
) {
    const out = [];
    for (const c of checks) out.push(...(await c.check(db)));
    for (const m of pendingMigrations(migrations, from, to))
        if (typeof m.check === 'function') out.push(...(await m.check(db)));
    return out;
}

/** Warnings (not refusals) from every `checks` entry's `warnings(db)`. */
export async function dataCheckWarnings(db, checks = DATA_CHECKS) {
    const out = [];
    for (const c of checks)
        if (typeof c.warnings === 'function')
            out.push(...(await c.warnings(db)));
    return out;
}

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

// ------------------------------------------------------------ runner

export async function readDataVersion(root) {
    const marker = await root
        .db(APP_DATABASE)
        .collection(DATA_VERSION_COLLECTION)
        .findOne({ _id: DATA_VERSION_ID });
    return {
        dataVersion: marker ? marker.dataVersion : 1,
        state: marker ? marker.state : 'ready',
    };
}

export async function setMarker(root, fields, history) {
    await root
        .db(APP_DATABASE)
        .collection(DATA_VERSION_COLLECTION)
        .updateOne(
            { _id: DATA_VERSION_ID },
            {
                $set: { ...fields, updatedAt: new Date() },
                ...(history ? { $push: { history } } : {}),
            },
            { upsert: true },
        );
}

/**
 * Runs the pending migrations against the app database, recording each
 * (`systemmigrations`) and the data version marker. Idempotent: a recorded
 * migration is skipped, an interrupted one runs again from its start (the
 * registry's contract), and the marker reaches `ready` only at the end.
 */
export async function runMigrations(
    root,
    plan,
    { onDataChange, log = () => {} } = {},
) {
    const db = root.db(APP_DATABASE);
    const records = db.collection(MIGRATION_COLLECTION);
    const applied = [];
    if (plan.migrations.length === 0 && plan.from === plan.to) return applied;
    // On a resume, the highest version already reached (not the start).
    let reached = plan.from;
    for (const m of plan.migrations)
        if (await records.findOne({ _id: m.id, state: 'done' }))
            reached = Math.max(reached, m.to);
    await setMarker(root, {
        dataVersion: reached,
        state: 'migrating',
        target: plan.to,
        release: plan.release,
    });
    for (const m of plan.migrations) {
        const done = await records.findOne({ _id: m.id, state: 'done' });
        if (done) {
            log(`migrate: ${m.id} already applied`);
            continue;
        }
        if (m.changesData !== false) await onDataChange?.(m);
        await records.updateOne(
            { _id: m.id },
            {
                $set: {
                    from: m.from,
                    to: m.to,
                    state: 'running',
                    startedAt: new Date(),
                    release: plan.release,
                },
            },
            { upsert: true },
        );
        const started = Date.now();
        log(`migrate: ${m.id} (${m.from} → ${m.to})`);
        await m.up(db, { log });
        await records.updateOne(
            { _id: m.id },
            {
                $set: {
                    state: 'done',
                    completedAt: new Date(),
                    durationMs: Date.now() - started,
                },
            },
        );
        await setMarker(root, {
            dataVersion: m.to,
            state: 'migrating',
            target: plan.to,
            release: plan.release,
        });
        applied.push(m.id);
    }
    await setMarker(
        root,
        { dataVersion: plan.to, state: 'ready', release: plan.release },
        {
            from: plan.from,
            to: plan.to,
            release: plan.release,
            at: new Date(),
            migrations: plan.migrations.map((m) => m.id),
        },
    );
    return applied;
}
