/**
 * One-off data migration for issue #15, run by
 * `migrate-decode-entities.ts` (see the README's operator notes).
 *
 * Until #15 a global SanitationPipe ran every request-body string through
 * sanitize-html, which stored `M&M's` as `M&amp;M's`. This module holds the
 * pure part of undoing that: which fields to look at, how to decode, and how
 * to plan the writes. It never talks to the database, so it is unit-tested
 * on plain objects.
 *
 * What the pipe stored: sanitize-html 2.17 (with `allowedTags: []`) first
 * DECODES its input, then re-encodes the text, and in text it emits only
 * `&amp;`, `&lt;` and `&gt;` (checked with the real library against every
 * code point up to U+3000; `"` and `'` pass through, `&nbsp;`/`&copy;` come
 * out as the characters). So stored = encode(decode(typed)): `M&M's` became
 * `M&amp;M's`, a typed `&lt;` was stored as `&lt;`, a typed `&quot;` as `"`,
 * and a typed `&amp;lt;` as `&amp;lt;`. Decoding the stored text once gives
 * back decode(typed): what the user typed, except that a literal entity
 * they typed had already been turned into its character by the pipe. That
 * loss happened on ingest and cannot be undone. `&quot;` is decoded too, in
 * case an older version wrote it; 2.17 never stores one.
 */

/** Names the run marker (`migrations`) and the progress records. */
export const MIGRATION_ID = 'issue-15-decode-html-entities';

const ENTITIES: Readonly<Record<string, string>> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
};

/** Source of the pattern, for both `decodeEntities` and database queries. */
export const ENTITY_SOURCE = '&(?:amp|lt|gt|quot);';

const ENTITY_PATTERN = new RegExp(ENTITY_SOURCE, 'g');

/**
 * Decodes the entities the pipe produced, in ONE pass, so a stored
 * `&amp;lt;` becomes `&lt;`, never `<`. Running it twice would decode that
 * a second time, which is why the migration records every document it
 * writes and never decodes one twice (see `runMigration`).
 */
export function decodeEntities(text: string): string {
    return text.replace(ENTITY_PATTERN, (entity) => ENTITIES[entity]);
}

/**
 * A collection to fix and the string fields in it that came from request
 * bodies. A field path is dotted; `[]` walks every element of an array
 * (`movements.[].reason`). `unique` names a field with a unique index.
 */
export interface CollectionTarget {
    /** Mongoose model name; the runner maps it to the collection. */
    model: string;
    fields: string[];
    unique?: string;
}

/**
 * Every stored field that was written from a request body through the
 * SanitationPipe (user-typed text, or a copy of a username). Products have
 * no description field; restocks and adjustments carry `description`.
 */
export const TARGETS: CollectionTarget[] = [
    { model: 'Product', fields: ['name'], unique: 'name' },
    { model: 'User', fields: ['name'], unique: 'name' },
    { model: 'Restock', fields: ['description'] },
    { model: 'Adjustment', fields: ['description'] },
    { model: 'AdjustmentDetails', fields: ['reason'] },
    { model: 'Sales', fields: ['discount.reason', 'reversal.reason'] },
    {
        model: 'Shift',
        fields: [
            'cashierName',
            'movements.[].reason',
            'movements.[].byName',
            'zRead.cashierName',
            'zRead.closedByName',
        ],
    },
];

/** One field of one document to rewrite. */
export interface FieldChange {
    /** The field pattern from `CollectionTarget.fields`. */
    field: string;
    /** The concrete dotted path, array indexes filled in. */
    path: string;
    from: string;
    to: string;
}

export interface DocumentEdit {
    _id: unknown;
    changes: FieldChange[];
}

type Doc = Record<string, unknown> & { _id?: unknown };

/** Every string at `field` in `doc`, with its concrete path. */
export function stringsAt(
    doc: unknown,
    field: string,
): { path: string; value: string }[] {
    const out: { path: string; value: string }[] = [];

    const walk = (node: unknown, parts: string[], path: string[]): void => {
        if (parts.length === 0) {
            if (typeof node === 'string') {
                out.push({ path: path.join('.'), value: node });
            }
            return;
        }
        const [head, ...rest] = parts;
        if (head === '[]') {
            if (Array.isArray(node)) {
                node.forEach((item, i) => walk(item, rest, [...path, `${i}`]));
            }
            return;
        }
        if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
            walk((node as Doc)[head], rest, [...path, head]);
        }
    };

    walk(doc, field.split('.'), []);
    return out;
}

/** The edit that decodes `doc`'s target fields, or null if none change. */
export function planDocument(fields: string[], doc: Doc): DocumentEdit | null {
    const changes: FieldChange[] = [];
    for (const field of fields) {
        for (const { path, value } of stringsAt(doc, field)) {
            const to = decodeEntities(value);
            if (to !== value) changes.push({ field, path, from: value, to });
        }
    }
    return changes.length > 0 ? { _id: doc._id, changes } : null;
}

/**
 * A MongoDB filter for the documents that may need an edit: any target
 * field containing one of the entities. (`movements.reason` matches inside
 * the array.)
 */
export function candidateFilter(fields: string[]): Record<string, unknown> {
    return {
        $or: fields.map((field) => ({
            [field.replace(/\.\[\]/g, '')]: { $regex: ENTITY_SOURCE },
        })),
    };
}

/** The filter + update for one edit: only applies if nothing moved since. */
export function editToUpdate(edit: DocumentEdit): {
    filter: Record<string, unknown>;
    update: { $set: Record<string, string> };
} {
    const filter: Record<string, unknown> = { _id: edit._id };
    const $set: Record<string, string> = {};
    for (const change of edit.changes) {
        filter[change.path] = change.from;
        $set[change.path] = change.to;
    }
    return { filter, update: { $set } };
}

export interface Collision {
    _id: unknown;
    field: string;
    from: string;
    to: string;
    /** The other documents that hold, or would hold, `to`. */
    conflictsWith: unknown[];
}

/**
 * Splits `edits` of a collection with a unique index on `field` into those
 * that can be written and those that would break the index.
 *
 * `owners` are the documents whose CURRENT value of `field` is one of the
 * decoded values (the runner looks them up). An edit collides when another
 * document already holds its decoded value, or when two edits decode to the
 * same value (both are skipped: which one should win is the operator's
 * call). Colliding documents are left as they are and reported.
 */
export function guardUnique(
    edits: DocumentEdit[],
    field: string,
    owners: Doc[],
): { kept: DocumentEdit[]; collisions: Collision[] } {
    const key = (id: unknown) => String(id);
    const holders = new Map<string, unknown[]>();
    const hold = (value: string, id: unknown) => {
        holders.set(value, [...(holders.get(value) ?? []), id]);
    };

    for (const owner of owners) {
        const value = owner[field];
        if (typeof value === 'string') hold(value, owner._id);
    }
    const targetOf = (edit: DocumentEdit) =>
        edit.changes.find((c) => c.path === field);
    for (const edit of edits) {
        const change = targetOf(edit);
        if (change) hold(change.to, edit._id);
    }

    const kept: DocumentEdit[] = [];
    const collisions: Collision[] = [];
    for (const edit of edits) {
        const change = targetOf(edit);
        const others = change
            ? (holders.get(change.to) ?? []).filter(
                  (id) => key(id) !== key(edit._id),
              )
            : [];
        if (change && others.length > 0) {
            collisions.push({
                _id: edit._id,
                field,
                from: change.from,
                to: change.to,
                conflictsWith: others,
            });
        } else {
            kept.push(edit);
        }
    }
    return { kept, collisions };
}

export interface FieldReport {
    field: string;
    documents: number;
    examples: { from: string; to: string }[];
}

export interface CollectionReport {
    collection: string;
    fields: FieldReport[];
    /** Documents that would be (or were) written. */
    documents: number;
    collisions: Collision[];
    /** Documents an earlier, interrupted run already decoded. */
    alreadyDone: number;
}

const EXAMPLES_PER_FIELD = 3;

/** Per field: how many documents change, with a few examples. */
export function summarize(
    collection: string,
    target: CollectionTarget,
    edits: DocumentEdit[],
    collisions: Collision[],
    alreadyDone = 0,
): CollectionReport {
    const fields = target.fields.map((field): FieldReport => {
        const touched = edits.filter((edit) =>
            edit.changes.some((c) => c.field === field),
        );
        const examples = touched
            .flatMap((edit) => edit.changes.filter((c) => c.field === field))
            .slice(0, EXAMPLES_PER_FIELD)
            .map(({ from, to }) => ({ from, to }));
        return { field, documents: touched.length, examples };
    });
    return {
        collection,
        fields,
        documents: edits.length,
        collisions,
        alreadyDone,
    };
}

/** The operator-facing report, one line per entry. */
export function formatReport(
    reports: CollectionReport[],
    applied: boolean,
): string[] {
    const verb = applied ? 'changed' : 'would change';
    const lines: string[] = [];
    for (const report of reports) {
        lines.push(
            `${report.collection}: ${report.documents} document(s) ${verb}`,
        );
        if (report.alreadyDone > 0) {
            lines.push(
                `  already decoded by an earlier run: ${report.alreadyDone}`,
            );
        }
        for (const field of report.fields) {
            lines.push(`  ${field.field}: ${field.documents}`);
            for (const { from, to } of field.examples) {
                lines.push(
                    `    ${JSON.stringify(from)} -> ${JSON.stringify(to)}`,
                );
            }
        }
        for (const c of report.collisions) {
            lines.push(
                `  SKIPPED ${String(c._id)} (${c.field}): ` +
                    `${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)} ` +
                    `would duplicate ${c.conflictsWith.map(String).join(', ')}; ` +
                    `rename one of them by hand`,
            );
        }
    }
    return lines;
}

/** The value at a concrete dotted path (`movements.1.reason`). */
export function valueAt(doc: unknown, path: string): unknown {
    return path
        .split('.')
        .reduce<unknown>(
            (node, key) =>
                node !== null && typeof node === 'object'
                    ? (node as Record<string, unknown>)[key]
                    : undefined,
            doc,
        );
}

/**
 * Where a document with a progress record stands now: `done` when it holds
 * the decoded values, `pending` when it still holds the values the plan was
 * made from (the write never landed, or failed), `moved` when it holds
 * neither (someone edited it, or it is gone).
 */
export function progressState(
    doc: unknown,
    changes: Pick<FieldChange, 'path' | 'from' | 'to'>[],
): 'done' | 'pending' | 'moved' {
    if (doc === undefined || doc === null) return 'moved';
    if (changes.every((c) => valueAt(doc, c.path) === c.to)) return 'done';
    if (changes.every((c) => valueAt(doc, c.path) === c.from)) {
        return 'pending';
    }
    return 'moved';
}

type Filter = Record<string, unknown>;

/** The slice of a MongoDB collection the migration uses (fakeable). */
export interface MigrationCollection<T = Doc> {
    collectionName: string;
    find(
        filter: Filter,
        options?: { projection?: Record<string, 1> },
    ): { toArray(): Promise<T[]> };
    updateOne(
        filter: Filter,
        update: Record<string, unknown>,
        options?: { upsert?: boolean },
    ): Promise<{ matchedCount: number }>;
}

export type ProgressStatus =
    'pending' | 'done' | 'moved' | 'collision' | 'failed';

/**
 * One document's planned edit, written to `migration_progress` BEFORE the
 * document itself is touched, and given the outcome afterwards.
 */
export interface ProgressRecord {
    _id: string;
    migration: string;
    collection: string;
    doc: unknown;
    changes: FieldChange[];
    status: ProgressStatus;
    runId: string;
    error?: string;
}

/** Who holds the run marker while a run is in progress. */
export interface MigrationLock {
    runId: string;
    /** `host:pid` of the process, for the operator. */
    owner: string;
    startedAt: Date;
}

/** The run marker in `migrations`: the lock and the run history. */
export interface MigrationMarker {
    _id: string;
    status: 'running' | 'incomplete' | 'complete';
    lock?: MigrationLock;
    runs: Record<string, unknown>[];
}

export interface MigrationRun {
    /** Maps a `CollectionTarget.model` to its collection. */
    collectionFor(model: string): MigrationCollection;
    /** The `migrations` collection: the run marker. */
    migrations: MigrationCollection<MigrationMarker>;
    /** The `migration_progress` collection: one record per planned write. */
    progress: MigrationCollection<ProgressRecord>;
    apply: boolean;
    /** Identifies this run in the marker and the progress records. */
    runId: string;
    /** `host:pid`, stored in the lock. */
    owner: string;
    /**
     * Take over a `running` marker. Only for a run that is known to be dead
     * (crashed or killed): two live runs can decode a document twice.
     */
    resumeStale?: boolean;
}

export interface MigrationOutcome {
    /**
     * 0 when it ran cleanly; 1 when a write failed, or the run was refused
     * (already complete, or another run holds the lock).
     */
    exitCode: number;
    /** Everything to print, in order. */
    lines: string[];
    reports: CollectionReport[];
    /** Documents that need a change but were left for the operator. */
    skipped: number;
    /** Writes that errored; a rerun retries them. */
    failed: number;
}

/** The flag that takes over a `running` marker left by a dead run. */
export const RESUME_STALE_FLAG = '--resume-stale';

function isDuplicateKey(err: unknown): boolean {
    return (err as { code?: unknown } | null)?.code === 11000;
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export function progressId(collection: string, id: unknown): string {
    return `${MIGRATION_ID}/${collection}/${String(id)}`;
}

function refused(message: string): MigrationOutcome {
    return {
        exitCode: 1,
        lines: [`Refusing: ${message}`],
        reports: [],
        skipped: 0,
        failed: 0,
    };
}

/** Progress statuses a rerun leaves alone: settled by an earlier run. */
const SETTLED: ReadonlySet<ProgressStatus> = new Set([
    'done',
    'moved',
    'collision',
]);

/**
 * Takes the run marker for this run, atomically: the filter only matches a
 * marker that no live run holds (or any unfinished one, with
 * `resumeStale`), and the upsert inserts one when there is none. Losing
 * either race surfaces as a duplicate key on the marker's `_id`.
 */
async function claimLock(run: MigrationRun): Promise<string | null> {
    const lock: MigrationLock = {
        runId: run.runId,
        owner: run.owner,
        startedAt: new Date(),
    };
    try {
        await run.migrations.updateOne(
            {
                _id: MIGRATION_ID,
                status: run.resumeStale
                    ? { $ne: 'complete' }
                    : { $nin: ['running', 'complete'] },
            },
            {
                $set: { status: 'running', lock },
                $push: {
                    runs: {
                        runId: run.runId,
                        owner: run.owner,
                        startedAt: lock.startedAt,
                    },
                },
            },
            { upsert: true },
        );
        return null;
    } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        const [marker] = await run.migrations
            .find({ _id: MIGRATION_ID })
            .toArray();
        if (marker?.status === 'complete') {
            return `${MIGRATION_ID} is already complete.`;
        }
        const holder = marker?.lock
            ? `run ${marker.lock.runId} on ${marker.lock.owner}, started ${new Date(marker.lock.startedAt).toISOString()}`
            : 'another run';
        return (
            `${MIGRATION_ID} is being applied by ${holder}. Two runs at ` +
            'once can decode a document twice. If that run is dead ' +
            `(crashed or killed), rerun with ${RESUME_STALE_FLAG}.`
        );
    }
}

type WriteResult =
    | { kind: 'written' }
    | { kind: 'moved' }
    | { kind: 'collision' }
    | { kind: 'failed'; error: string };

/**
 * Plans every target collection and, with `apply`, writes the plan one
 * document at a time. Safe against crashes and concurrent runs:
 *
 * - The run first claims the marker in `migrations` atomically (status
 *   `running`, with its run id and `host:pid`). A second run refuses while
 *   it is held; `resumeStale` takes over one left by a dead run.
 * - Before a document is written, its exact edit (paths, old and new
 *   values) is recorded in `migration_progress`; the write itself filters
 *   on the old values.
 * - A document with a progress record is never planned again. A rerun
 *   leaves settled records (done, moved, collision) alone, and compares the
 *   others (pending, failed) with the document: holding the new values, it
 *   is done and NOT decoded again; holding the old values, the write never
 *   landed and it is retried; holding neither, it was edited meanwhile and
 *   is reported. So a crash at any point is harmless.
 * - On a collection with a unique name, an edit whose decoded name is taken
 *   is retried after the others are written, as long as that frees names
 *   (`&amp;lt;x` waits for the `&lt;x` that becomes `<x`). What still
 *   collides after that is a real duplicate, skipped and reported.
 * - The marker ends `complete` only when no write failed; then further
 *   applies are refused, because text typed after the fix may legitimately
 *   contain `&amp;`. With failed writes it ends `incomplete`, the exit code
 *   is 1, and a rerun retries exactly those documents.
 */
export async function runMigration(
    run: MigrationRun,
): Promise<MigrationOutcome> {
    const lines: string[] = [];
    const [marker] = await run.migrations.find({ _id: MIGRATION_ID }).toArray();
    if (marker?.status === 'complete') {
        const message =
            `${MIGRATION_ID} is already complete; running it again would ` +
            'decode text typed since the fix.';
        if (run.apply) return refused(message);
        lines.push(`WARNING: ${message}`);
    } else if (marker?.status === 'running' && !run.apply) {
        lines.push(
            `WARNING: a run holds the lock (${marker.lock?.owner ?? '?'}); ` +
                'this dry run may be out of date by the time it prints.',
        );
    } else if (marker) {
        lines.push(
            `Resuming: an earlier run left it ${marker.status}. Documents it ` +
                'decoded are not decoded again; failed ones are retried.',
        );
    }

    if (run.apply) {
        const refusal = await claimLock(run);
        if (refusal) return refused(refusal);
    }

    const reports: CollectionReport[] = [];
    const problems: string[] = [];
    let skipped = 0;
    let failed = 0;
    let written = 0;

    for (const target of TARGETS) {
        const collection = run.collectionFor(target.model);
        const name = collection.collectionName;

        // What earlier runs planned here. Settled records are left alone.
        const records = await run.progress
            .find({ migration: MIGRATION_ID, collection: name })
            .toArray();
        const recorded = new Set(records.map((r) => String(r.doc)));
        const open = records.filter((r) => !SETTLED.has(r.status));
        let alreadyDone = records.length - open.length;
        const current =
            open.length > 0
                ? await collection
                      .find({ _id: { $in: open.map((r) => r.doc) } })
                      .toArray()
                : [];
        const byId = new Map(current.map((d) => [String(d._id), d]));

        const retries: DocumentEdit[] = [];
        for (const record of open) {
            const state = progressState(
                byId.get(String(record.doc)),
                record.changes,
            );
            if (state === 'done') {
                alreadyDone += 1;
            } else if (state === 'pending') {
                retries.push({ _id: record.doc, changes: record.changes });
            } else {
                skipped += 1;
                problems.push(
                    `  SKIPPED ${name} ${String(record.doc)}: changed since it was planned; check it by hand`,
                );
            }
        }

        const docs = await collection
            .find(candidateFilter(target.fields))
            .toArray();
        const edits: DocumentEdit[] = [
            ...retries,
            ...docs
                .filter((doc) => !recorded.has(String(doc._id)))
                .map((doc) => planDocument(target.fields, doc))
                .filter((edit): edit is DocumentEdit => edit !== null),
        ];

        const field = target.unique;
        const editById = new Map(edits.map((e) => [String(e._id), e] as const));
        const editsOf = (list: Collision[]) =>
            list
                .map((c) => editById.get(String(c._id)))
                .filter((e): e is DocumentEdit => e !== undefined);

        /**
         * Splits `candidates` by whether their decoded name is free, given
         * the names in the database now plus `claimed` (edits accepted in a
         * dry run, which would have moved by then).
         */
        const guard = async (
            candidates: DocumentEdit[],
            claimed: DocumentEdit[] = [],
        ): Promise<{ kept: DocumentEdit[]; collisions: Collision[] }> => {
            if (!field || candidates.length === 0) {
                return { kept: candidates, collisions: [] };
            }
            const decoded = candidates.flatMap((edit) =>
                edit.changes.filter((c) => c.path === field).map((c) => c.to),
            );
            const moved = new Set(claimed.map((e) => String(e._id)));
            const owners = [
                ...(
                    await collection
                        .find(
                            { [field]: { $in: decoded } },
                            { projection: { [field]: 1 } },
                        )
                        .toArray()
                ).filter((o) => !moved.has(String(o._id))),
                ...claimed.flatMap((e) =>
                    e.changes
                        .filter((c) => c.path === field)
                        .map((c) => ({ _id: e._id, [field]: c.to })),
                ),
            ];
            return guardUnique(candidates, field, owners);
        };

        const first = await guard(edits);
        let collisions = first.collisions;

        if (!run.apply) {
            // Simulate the retry below: names freed by accepted edits.
            let accepted = first.kept;
            while (collisions.length > 0) {
                const next = await guard(editsOf(collisions), accepted);
                if (next.kept.length === 0) break;
                accepted = [...accepted, ...next.kept];
                collisions = next.collisions;
            }
            skipped += collisions.length;
            reports.push(
                summarize(name, target, accepted, collisions, alreadyDone),
            );
            continue;
        }

        const done: DocumentEdit[] = [];
        /** Edits that lost a race on the unique index in `write`. */
        let raced: Collision[] = [];

        const write = async (edit: DocumentEdit): Promise<void> => {
            const _id = progressId(name, edit._id);
            // The record first: whatever happens next, a rerun can tell.
            await run.progress.updateOne(
                { _id },
                {
                    $set: {
                        migration: MIGRATION_ID,
                        collection: name,
                        doc: edit._id,
                        changes: edit.changes,
                        status: 'pending',
                        runId: run.runId,
                    },
                },
                { upsert: true },
            );

            let result: WriteResult;
            const { filter, update } = editToUpdate(edit);
            try {
                const res = await collection.updateOne(filter, update);
                result = {
                    kind: res.matchedCount === 1 ? 'written' : 'moved',
                };
            } catch (err) {
                result = isDuplicateKey(err)
                    ? { kind: 'collision' }
                    : { kind: 'failed', error: messageOf(err) };
            }

            const change = edit.changes[0];
            switch (result.kind) {
                case 'written':
                    done.push(edit);
                    break;
                case 'moved':
                    skipped += 1;
                    problems.push(
                        `  SKIPPED ${name} ${String(edit._id)}: changed since it was read; check it by hand`,
                    );
                    break;
                case 'collision':
                    raced.push({
                        _id: edit._id,
                        field: change.field,
                        from: change.from,
                        to: change.to,
                        conflictsWith: ['(unique index)'],
                    });
                    break;
                case 'failed':
                    failed += 1;
                    problems.push(
                        `  FAILED ${name} ${String(edit._id)}: ${result.error} (a rerun retries it)`,
                    );
                    break;
            }

            // The outcome, outside the write's error handling: if this
            // fails the record stays `pending`, and a rerun re-examines it.
            const status: ProgressStatus =
                result.kind === 'written' ? 'done' : result.kind;
            try {
                await run.progress.updateOne(
                    { _id },
                    {
                        $set: {
                            status,
                            ...(result.kind === 'failed'
                                ? { error: result.error }
                                : {}),
                        },
                    },
                );
            } catch (err) {
                problems.push(
                    `  NOTE ${name} ${String(edit._id)}: ${result.kind}; ` +
                        `its progress mark failed (${messageOf(err)}), a rerun will confirm it`,
                );
            }
        };

        for (const edit of first.kept) await write(edit);

        // Edits whose name was taken may be free now that other renames in
        // this run have landed (`&amp;lt;x` waits for the `&lt;x` that
        // became `<x`): retry while that makes progress.
        collisions = [...collisions, ...raced];
        while (collisions.length > 0) {
            raced = [];
            const next = await guard(editsOf(collisions));
            const before = done.length;
            for (const edit of next.kept) await write(edit);
            collisions = [...next.collisions, ...raced];
            if (done.length === before) break;
        }
        skipped += collisions.length;

        written += done.length;
        reports.push(summarize(name, target, done, collisions, alreadyDone));
    }

    lines.push(...formatReport(reports, run.apply), ...problems);

    if (run.apply) {
        const status = failed > 0 ? 'incomplete' : 'complete';
        const res = await run.migrations.updateOne(
            {
                _id: MIGRATION_ID,
                'lock.runId': run.runId,
                'runs.runId': run.runId,
            },
            {
                $set: {
                    status,
                    'runs.$.finishedAt': new Date(),
                    'runs.$.written': written,
                    'runs.$.skipped': skipped,
                    'runs.$.failed': failed,
                },
                $unset: { lock: '' },
            },
        );
        if (res.matchedCount === 1) {
            lines.push(`Marked ${MIGRATION_ID} ${status} in 'migrations'.`);
        } else {
            failed += 1;
            lines.push(
                `The lock was taken over (${RESUME_STALE_FLAG}) while this ` +
                    'run was going; the marker was left to that run. Check ' +
                    'both runs’ output.',
            );
        }
    }
    if (skipped > 0) {
        lines.push(`${skipped} document(s) left unchanged: see SKIPPED above.`);
    }
    if (failed > 0) {
        lines.push(
            `${failed} problem(s) FAILED: fix the cause and run --apply ` +
                'again. It retries them and decodes nothing twice.',
        );
    }
    return {
        exitCode: failed > 0 ? 1 : 0,
        lines,
        reports,
        skipped,
        failed,
    };
}
