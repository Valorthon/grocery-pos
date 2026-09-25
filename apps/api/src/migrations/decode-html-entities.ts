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
 * Which entities: sanitize-html 2.17 (with `allowedTags: []`) decodes its
 * input and re-encodes text with its `escapeHtml`, which in text emits only
 * `&amp;`, `&lt;` and `&gt;` (checked against every code point up to
 * U+3000; `"` and `'` pass through, `&nbsp;`/`&copy;` come out as the
 * characters). `&quot;` is decoded as well, in case an older version wrote
 * it: the pipe never let a bare `&quot;` through (typed, it was stored as
 * `&amp;quot;`), so decoding it cannot damage anything the pipe stored.
 */

/** Marks the migration as applied (collection `migrations`). */
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
 * Decodes the entities the pipe produced, in ONE pass: `&amp;lt;` (the user
 * typed `&lt;`) becomes `&lt;`, never `<`. Running it twice would decode
 * that a second time, which is why the migration refuses a second apply.
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
}

const EXAMPLES_PER_FIELD = 3;

/** Per field: how many documents change, with a few examples. */
export function summarize(
    collection: string,
    target: CollectionTarget,
    edits: DocumentEdit[],
    collisions: Collision[],
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
    return { collection, fields, documents: edits.length, collisions };
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

/** The slice of a MongoDB collection the migration uses (fakeable). */
export interface MigrationCollection {
    collectionName: string;
    find(
        filter: Record<string, unknown>,
        options?: { projection?: Record<string, 1> },
    ): { toArray(): Promise<Doc[]> };
    updateOne(
        filter: Record<string, unknown>,
        update: { $set: Record<string, string> },
    ): Promise<{ matchedCount: number }>;
}

/** The `migrations` collection, where a finished apply records itself. */
export interface MigrationLog {
    findOne(filter: { _id: string }): Promise<unknown>;
    insertOne(doc: { _id: string } & Record<string, unknown>): Promise<unknown>;
}

export interface MigrationRun {
    /** Maps a `CollectionTarget.model` to its collection. */
    collectionFor(model: string): MigrationCollection;
    migrations: MigrationLog;
    apply: boolean;
}

export interface MigrationOutcome {
    /** 0 when it ran, 1 when a second apply was refused. */
    exitCode: number;
    /** Everything to print, in order. */
    lines: string[];
    reports: CollectionReport[];
    /** Documents that need a change but were left as they were. */
    skipped: number;
}

function isDuplicateKey(err: unknown): boolean {
    return (err as { code?: unknown } | null)?.code === 11000;
}

/**
 * Plans every target collection and, with `apply`, writes the plan one
 * document at a time. A write that matches nothing (the document changed
 * since it was read), hits the unique index, or fails otherwise is reported
 * and skipped; the run always goes on. A finished apply is recorded in
 * `migrations`, and a second apply is refused.
 */
export async function runMigration(
    run: MigrationRun,
): Promise<MigrationOutcome> {
    const lines: string[] = [];
    const done = await run.migrations.findOne({ _id: MIGRATION_ID });
    if (done) {
        const message =
            `${MIGRATION_ID} was already applied (${JSON.stringify(done)}); ` +
            'running it again would decode a second time.';
        if (run.apply) {
            return {
                exitCode: 1,
                lines: [`Refusing: ${message}`],
                reports: [],
                skipped: 0,
            };
        }
        lines.push(`WARNING: ${message}`);
    }

    const reports: CollectionReport[] = [];
    const problems: string[] = [];
    let skipped = 0;

    for (const target of TARGETS) {
        const collection = run.collectionFor(target.model);
        const name = collection.collectionName;
        const docs = await collection
            .find(candidateFilter(target.fields))
            .toArray();
        let edits = docs
            .map((doc) => planDocument(target.fields, doc))
            .filter((edit): edit is DocumentEdit => edit !== null);

        let collisions: Collision[] = [];
        if (target.unique && edits.length > 0) {
            const field = target.unique;
            const decoded = edits.flatMap((edit) =>
                edit.changes.filter((c) => c.path === field).map((c) => c.to),
            );
            const owners = await collection
                .find(
                    { [field]: { $in: decoded } },
                    { projection: { [field]: 1 } },
                )
                .toArray();
            ({ kept: edits, collisions } = guardUnique(edits, field, owners));
        }
        skipped += collisions.length;

        if (run.apply) {
            const written: DocumentEdit[] = [];
            for (const edit of edits) {
                const { filter, update } = editToUpdate(edit);
                try {
                    const res = await collection.updateOne(filter, update);
                    if (res.matchedCount === 1) {
                        written.push(edit);
                    } else {
                        problems.push(
                            `  SKIPPED ${name} ${String(edit._id)}: changed since it was read; check it by hand`,
                        );
                    }
                } catch (err) {
                    const change = edit.changes[0];
                    if (isDuplicateKey(err)) {
                        // Another write took the name after the plan.
                        collisions.push({
                            _id: edit._id,
                            field: change.field,
                            from: change.from,
                            to: change.to,
                            conflictsWith: ['(unique index)'],
                        });
                    } else {
                        problems.push(
                            `  FAILED ${name} ${String(edit._id)}: ${err instanceof Error ? err.message : String(err)}`,
                        );
                    }
                }
            }
            skipped += edits.length - written.length;
            edits = written;
        }

        reports.push(summarize(name, target, edits, collisions));
    }

    lines.push(...formatReport(reports, run.apply), ...problems);

    if (run.apply) {
        await run.migrations.insertOne({
            _id: MIGRATION_ID,
            appliedAt: new Date(),
            documents: Object.fromEntries(
                reports.map((r) => [r.collection, r.documents]),
            ),
            skipped,
        });
        lines.push(`Recorded ${MIGRATION_ID} in the migrations collection.`);
    }
    if (skipped > 0) {
        lines.push(
            `${skipped} document(s) left unchanged: see SKIPPED/FAILED above.`,
        );
    }
    return { exitCode: 0, lines, reports, skipped };
}
