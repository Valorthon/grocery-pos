import { Types } from 'mongoose';
import {
    candidateFilter,
    decodeEntities,
    DocumentEdit,
    editToUpdate,
    ENTITY_SOURCE,
    formatReport,
    guardUnique,
    MIGRATION_ID,
    MigrationCollection,
    MigrationMarker,
    MigrationRun,
    planDocument,
    ProgressRecord,
    progressId,
    progressState,
    runMigration,
    valueAt,
    stringsAt,
    summarize,
    TARGETS,
} from './decode-html-entities';

/**
 * Stored forms below are what sanitize-html 2.17.7 actually produced with
 * the old pipe's options (checked by running the real library): it decodes
 * its input, then re-encodes `&`, `<` and `>`. So stored =
 * encode(decode(typed)).
 */
describe('decodeEntities', () => {
    it.each([
        // [typed, stored by the old pipe, decoded now]
        [
            "M&M's qty < 10 a>b",
            "M&amp;M's qty &lt; 10 a&gt;b",
            "M&M's qty < 10 a>b",
        ],
        ['Tom & Jerry', 'Tom &amp; Jerry', 'Tom & Jerry'],
        ['m&m', 'm&amp;m', 'm&m'],
        ['a &foo; b', 'a &amp;foo; b', 'a &foo; b'],
        // Quotes were never encoded.
        ['say "hi"', 'say "hi"', 'say "hi"'],
        ['plain text', 'plain text', 'plain text'],
    ])('typed %j, stored %j -> %j', (_typed, stored, decoded) => {
        expect(decodeEntities(stored)).toBe(decoded);
    });

    it('decodes in a single pass: one level only', () => {
        // Typed `&amp;lt;`: the pipe decoded it to `&lt;` and stored
        // `&amp;lt;`. One pass gives back `&lt;`, never `<`.
        expect(decodeEntities('&amp;lt;')).toBe('&lt;');
        // Typed `&amp;amp;lt;`, stored as such.
        expect(decodeEntities('&amp;amp;lt;')).toBe('&amp;lt;');
        expect(decodeEntities('a &amp;lt;b&amp;gt; c')).toBe('a &lt;b&gt; c');
    });

    it('cannot restore a literal entity the pipe already decoded', () => {
        // Typed `&lt;` was decoded on ingest and stored as `&lt;` (the
        // encoding of `<`), indistinguishable from a typed `<`. That loss
        // happened in the old pipe; decoding yields the character.
        expect(decodeEntities('&lt;')).toBe('<');
        expect(decodeEntities('&amp;')).toBe('&');
    });

    it('also decodes &quot;, in case an older sanitize-html stored it', () => {
        expect(decodeEntities('say &quot;hi&quot;')).toBe('say "hi"');
    });

    it('leaves other entities and near-misses alone', () => {
        for (const text of [
            '&nbsp;',
            '&#39;',
            '&#x26;',
            '&AMP;',
            '&amp',
            'amp;',
            '& amp;',
        ]) {
            expect(decodeEntities(text)).toBe(text);
        }
    });

    it('is stable across calls (the global regex keeps no state)', () => {
        expect(decodeEntities('a&amp;b')).toBe('a&b');
        expect(decodeEntities('a&amp;b')).toBe('a&b');
    });
});

describe('stringsAt', () => {
    const shift = {
        cashierName: 'x',
        movements: [{ reason: 'a' }, { reason: 7 }, { reason: 'c' }],
        zRead: { closedByName: 'z' },
    };

    it('walks nested objects and arrays', () => {
        expect(stringsAt(shift, 'movements.[].reason')).toEqual([
            { path: 'movements.0.reason', value: 'a' },
            { path: 'movements.2.reason', value: 'c' },
        ]);
        expect(stringsAt(shift, 'zRead.closedByName')).toEqual([
            { path: 'zRead.closedByName', value: 'z' },
        ]);
    });

    it('skips missing and non-string values', () => {
        expect(stringsAt({}, 'discount.reason')).toEqual([]);
        expect(stringsAt({ discount: null }, 'discount.reason')).toEqual([]);
        expect(stringsAt({ movements: 'no' }, 'movements.[].reason')).toEqual(
            [],
        );
    });
});

describe('planDocument', () => {
    const fields = ['discount.reason', 'reversal.reason'];

    it('plans only the fields that change', () => {
        const _id = new Types.ObjectId();

        expect(
            planDocument(fields, {
                _id,
                discount: { reason: 'Tom &amp; Jerry' },
                reversal: { reason: 'wrong item' },
            }),
        ).toEqual({
            _id,
            changes: [
                {
                    field: 'discount.reason',
                    path: 'discount.reason',
                    from: 'Tom &amp; Jerry',
                    to: 'Tom & Jerry',
                },
            ],
        });
    });

    it('returns null when nothing is encoded', () => {
        expect(
            planDocument(fields, { _id: 1, discount: { reason: 'a & b' } }),
        ).toBeNull();
    });

    it('plans every array element that changes', () => {
        const target = TARGETS.find((t) => t.model === 'Shift')!;
        const edit = planDocument(target.fields, {
            _id: 1,
            cashierName: 'ann',
            movements: [
                { reason: 'ok', byName: 'ann' },
                { reason: 'float &lt;100', byName: 'b&amp;b' },
            ],
        });

        expect(edit?.changes.map((c) => [c.path, c.to])).toEqual([
            ['movements.1.reason', 'float <100'],
            ['movements.1.byName', 'b&b'],
        ]);
    });
});

describe('editToUpdate', () => {
    it('filters on the old values so a moved document is not overwritten', () => {
        const edit = planDocument(['description'], {
            _id: 'r1',
            description: 'a &amp; b',
        })!;

        expect(editToUpdate(edit)).toEqual({
            filter: { _id: 'r1', description: 'a &amp; b' },
            update: { $set: { description: 'a & b' } },
        });
    });
});

describe('candidateFilter', () => {
    it('matches any target field, arrays by their element path', () => {
        expect(candidateFilter(['name', 'movements.[].reason'])).toEqual({
            $or: [
                { name: { $regex: ENTITY_SOURCE } },
                { 'movements.reason': { $regex: ENTITY_SOURCE } },
            ],
        });
    });
});

describe('guardUnique (Product.name, User.name)', () => {
    const edit = (_id: string, from: string): DocumentEdit =>
        planDocument(['name'], { _id, name: from })!;

    it('keeps an edit whose decoded name is free', () => {
        const edits = [edit('p1', 'm&amp;m')];

        const { kept, collisions } = guardUnique(edits, 'name', []);

        expect(kept).toEqual(edits);
        expect(collisions).toEqual([]);
    });

    it('skips an edit whose decoded name another document already has', () => {
        const edits = [edit('p1', 'm&amp;m'), edit('p2', 'a&lt;b')];
        const owners = [{ _id: 'p9', name: 'm&m' }];

        const { kept, collisions } = guardUnique(edits, 'name', owners);

        expect(kept.map((e) => e._id)).toEqual(['p2']);
        expect(collisions).toEqual([
            {
                _id: 'p1',
                field: 'name',
                from: 'm&amp;m',
                to: 'm&m',
                conflictsWith: ['p9'],
            },
        ]);
    });

    it('skips both edits when two decode to the same name', () => {
        // Only possible with a `&quot;` from an older sanitize-html: 2.17's
        // stored forms decode one-to-one.
        const edits = [
            edit('p1', 'say &quot;hi&quot;'),
            edit('p2', 'say &quot;hi"'),
        ];

        const { kept, collisions } = guardUnique(edits, 'name', []);

        expect(kept).toEqual([]);
        expect(collisions.map((c) => [c._id, c.to, c.conflictsWith])).toEqual([
            ['p1', 'say "hi"', ['p2']],
            ['p2', 'say "hi"', ['p1']],
        ]);
    });

    it('compares ObjectIds by value, not by reference', () => {
        const id = new Types.ObjectId();
        const edits: DocumentEdit[] = [
            {
                _id: id,
                changes: [
                    { field: 'name', path: 'name', from: 'a&amp;b', to: 'a&b' },
                ],
            },
        ];
        // Another document holding the name collides; the document itself
        // (a different ObjectId instance, same id) does not.
        const other = new Types.ObjectId();

        expect(
            guardUnique(edits, 'name', [{ _id: other, name: 'a&b' }])
                .collisions,
        ).toHaveLength(1);
        expect(
            guardUnique(edits, 'name', [
                { _id: new Types.ObjectId(id.toString()), name: 'a&b' },
            ]).collisions,
        ).toHaveLength(0);
    });
});

describe('summarize and formatReport', () => {
    const target = {
        model: 'Sales',
        fields: ['discount.reason', 'reversal.reason'],
    };
    const edits = [1, 2, 3, 4].map((n) =>
        planDocument(target.fields, {
            _id: n,
            discount: { reason: `r${n} &amp;` },
        })!,
    );

    it('counts documents per field with at most three examples', () => {
        const report = summarize('sales', target, edits, []);

        expect(report.documents).toBe(4);
        expect(report.fields).toEqual([
            {
                field: 'discount.reason',
                documents: 4,
                examples: [
                    { from: 'r1 &amp;', to: 'r1 &' },
                    { from: 'r2 &amp;', to: 'r2 &' },
                    { from: 'r3 &amp;', to: 'r3 &' },
                ],
            },
            { field: 'reversal.reason', documents: 0, examples: [] },
        ]);
    });

    it('prints a dry run, and each skipped collision', () => {
        const lines = formatReport(
            [
                summarize('sales', target, edits.slice(0, 1), []),
                summarize(
                    'products',
                    { model: 'Product', fields: ['name'] },
                    [],
                    [
                        {
                            _id: 'p1',
                            field: 'name',
                            from: 'm&amp;m',
                            to: 'm&m',
                            conflictsWith: ['p9'],
                        },
                    ],
                ),
            ],
            false,
        );

        expect(lines).toEqual([
            'sales: 1 document(s) would change',
            '  discount.reason: 1',
            '    "r1 &amp;" -> "r1 &"',
            '  reversal.reason: 0',
            'products: 0 document(s) would change',
            '  name: 0',
            '  SKIPPED p1 (name): "m&amp;m" -> "m&m" would duplicate p9; rename one of them by hand',
        ]);
    });
});

describe('TARGETS', () => {
    it('covers every text field written from a request body', () => {
        expect(
            Object.fromEntries(TARGETS.map((t) => [t.model, t.fields])),
        ).toEqual({
            Product: ['name'],
            User: ['name'],
            Restock: ['description'],
            Adjustment: ['description'],
            AdjustmentDetails: ['reason'],
            Sales: ['discount.reason', 'reversal.reason'],
            Shift: [
                'cashierName',
                'movements.[].reason',
                'movements.[].byName',
                'zRead.cashierName',
                'zRead.closedByName',
            ],
        });
        expect(TARGETS.filter((t) => t.unique).map((t) => t.model)).toEqual([
            'Product',
            'User',
        ]);
    });
});

type Row = Record<string, unknown> & { _id: unknown };

function setPath(doc: Row, path: string, value: unknown): void {
    const keys = path.split('.');
    const last = keys.pop()!;
    let node = doc as Record<string, unknown>;
    for (const key of keys) {
        node[key] ??= {};
        node = node[key] as Record<string, unknown>;
    }
    node[last] = value;
}

/** The fakes use string ids, so plain equality is enough. */
const same = (a: unknown, b: unknown) => a === b;

/**
 * Does `row` match a filter of equalities, `$in`, `$ne`, `$nin` and a
 * (skipped) `$or`?
 */
function matches(row: Row, filter: Record<string, unknown>): boolean {
    return Object.entries(filter).every(([path, cond]) => {
        if (path === '$or') return true; // planDocument does the filtering
        if (path === 'runs.runId') {
            return ((row.runs as Row[]) ?? []).some((r) => r.runId === cond);
        }
        const value = valueAt(row, path);
        if (cond !== null && typeof cond === 'object') {
            const op = cond as {
                $in?: unknown[];
                $nin?: unknown[];
                $ne?: unknown;
            };
            if (op.$in) return op.$in.some((v) => same(value, v));
            if (op.$nin) return !op.$nin.some((v) => same(value, v));
            if ('$ne' in op) return !same(value, op.$ne);
        }
        return same(value, cond);
    });
}

const duplicateKey = () =>
    Object.assign(new Error('E11000 duplicate key'), { code: 11000 });

/**
 * An in-memory collection with the slice of MongoDB semantics the
 * migration uses: equality/`$in`/`$ne`/`$nin` filters, `$set` (dotted and
 * `runs.$.x` positional), `$unset`, `$push`, upsert (a duplicate `_id`
 * throws E11000, as MongoDB does), and an optional unique field.
 */
class FakeCollection<T extends Row = Row> {
    /** Called before each `updateOne`, with its filter. */
    beforeWrite?: (filter: Record<string, unknown>) => void;
    /** Called after each `updateOne` has applied (a crash just after). */
    afterWrite?: (filter: Record<string, unknown>) => void;
    /** Awaited by each `find` before it reads: lets a test pause a run. */
    beforeFind?: (filter: Record<string, unknown>) => Promise<void>;
    /** Awaited by each `find` after it has read, before it returns. */
    afterFind?: (filter: Record<string, unknown>) => Promise<void>;
    /** A field with a unique index. */
    unique?: string;
    /** Ids whose document write throws this error. */
    readonly throwOn = new Map<string, unknown>();
    readonly writes: Record<string, unknown>[] = [];

    constructor(
        readonly collectionName: string,
        readonly rows: T[] = [],
    ) {}

    find(filter: Record<string, unknown>) {
        return {
            toArray: async () => {
                await this.beforeFind?.(filter);
                const rows = structuredClone(
                    this.rows.filter((row) => matches(row, filter)),
                );
                await this.afterFind?.(filter);
                return rows;
            },
        };
    }

    updateOne(
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        options?: { upsert?: boolean },
    ) {
        this.beforeWrite?.(filter);
        const error = this.throwOn.get(String(filter._id));
        if (error) return Promise.reject(error as Error);
        this.writes.push(filter);

        let row = this.rows.find((r) => matches(r, filter));
        const $set = (update.$set ?? {}) as Record<string, unknown>;
        const taken =
            this.unique !== undefined &&
            this.unique in $set &&
            this.rows.some(
                (r) => r !== row && r[this.unique!] === $set[this.unique!],
            );
        if (taken) return Promise.reject(duplicateKey());
        if (!row) {
            if (!options?.upsert) return Promise.resolve({ matchedCount: 0 });
            if (this.rows.some((r) => r._id === filter._id)) {
                return Promise.reject(duplicateKey());
            }
            row = { _id: filter._id } as T;
            this.rows.push(row);
        }
        for (const [path, value] of Object.entries($set)) {
            if (path.startsWith('runs.$.')) {
                const run = (row.runs as Row[]).find(
                    (r) => r.runId === filter['runs.runId'],
                )!;
                run[path.slice('runs.$.'.length)] = value;
            } else {
                setPath(row, path, structuredClone(value));
            }
        }
        for (const path of Object.keys(update.$unset ?? {})) {
            delete row[path];
        }
        const $push = (update.$push ?? {}) as Record<string, unknown>;
        for (const [path, value] of Object.entries($push)) {
            const list = (valueAt(row, path) as unknown[]) ?? [];
            setPath(row, path, [...list, value]);
        }
        this.afterWrite?.(filter);
        return Promise.resolve({ matchedCount: 1 });
    }
}

describe('runMigration', () => {
    let collections: Record<string, FakeCollection>;
    let migrations: FakeCollection<MigrationMarker & Row>;
    let progress: FakeCollection<ProgressRecord & Row>;
    let runs = 0;

    function run(apply: boolean, resumeStale = false) {
        runs += 1;
        return runMigration({
            apply,
            resumeStale,
            owner: `host:${runs}`,
            runId: `run-${runs}`,
            migrations: migrations as unknown as MigrationRun['migrations'],
            progress: progress as unknown as MigrationRun['progress'],
            collectionFor: (model) =>
                collections[model] as unknown as MigrationCollection,
        });
    }

    const reversal = () =>
        valueAt(collections.Sales.rows[0], 'reversal.reason');
    const drop = () => valueAt(collections.Shift.rows[0], 'movements.1.reason');
    const marker = () => migrations.rows[0];

    beforeEach(() => {
        runs = 0;
        migrations = new FakeCollection('migrations');
        progress = new FakeCollection('migration_progress');
        collections = Object.fromEntries(
            TARGETS.map((t) => [
                t.model,
                new FakeCollection(t.model.toLowerCase()),
            ]),
        );
        collections.Product.rows.push(
            { _id: 'p1', name: 'm&amp;m peanut' },
            { _id: 'p2', name: 'a&amp;b' },
            { _id: 'p3', name: 'a&b' },
            { _id: 'p4', name: 'plain' },
        );
        collections.Sales.rows.push({
            _id: 's1',
            discount: { reason: 'Tom &amp; Jerry' },
            // The pipe's encoding of a typed `&amp;lt;`: decodes to `&lt;`,
            // and must never become `<`.
            reversal: { reason: 'typed &amp;lt; literally' },
        });
        collections.Shift.rows.push({
            _id: 'h1',
            cashierName: 'ann',
            movements: [
                { reason: 'float', byName: 'ann' },
                { reason: 'drop &gt; 5k', byName: 'ann' },
            ],
        });
    });

    it('a dry run reports and writes nothing', async () => {
        const before = structuredClone(collections);

        const outcome = await run(false);

        expect(outcome.exitCode).toBe(0);
        expect(collections).toEqual(before);
        expect(migrations.rows).toEqual([]);
        expect(progress.rows).toEqual([]);
        expect(outcome.lines).toEqual(
            expect.arrayContaining([
                'product: 1 document(s) would change',
                '    "m&amp;m peanut" -> "m&m peanut"',
                '  SKIPPED p2 (name): "a&amp;b" -> "a&b" would duplicate p3; rename one of them by hand',
                'sales: 1 document(s) would change',
                'shift: 1 document(s) would change',
                '  movements.[].reason: 1',
            ]),
        );
        expect(outcome.skipped).toBe(1);
    });

    it('--apply decodes, skips the collision and marks itself complete', async () => {
        const outcome = await run(true);

        expect(outcome.exitCode).toBe(0);
        expect(collections.Product.rows.map((r) => r.name)).toEqual([
            'm&m peanut',
            'a&amp;b', // would duplicate p3: left for the operator
            'a&b',
            'plain',
        ]);
        expect(collections.Sales.rows[0]).toEqual({
            _id: 's1',
            discount: { reason: 'Tom & Jerry' },
            reversal: { reason: 'typed &lt; literally' },
        });
        expect(drop()).toBe('drop > 5k');
        expect(marker()).toMatchObject({
            _id: MIGRATION_ID,
            status: 'complete',
            runs: [
                expect.objectContaining({
                    runId: 'run-1',
                    written: 3,
                    skipped: 1,
                    failed: 0,
                }),
            ],
        });
        expect(progress.rows.map((r) => [r._id, r.status])).toEqual([
            [progressId('product', 'p1'), 'done'],
            [progressId('sales', 's1'), 'done'],
            [progressId('shift', 'h1'), 'done'],
        ]);
    });

    it('marks the run started and records each edit before writing it', async () => {
        const order: string[] = [];
        migrations.beforeWrite = () => order.push('marker');
        progress.beforeWrite = (f) => order.push(`progress ${String(f._id)}`);
        collections.Sales.beforeWrite = (f) =>
            order.push(`write ${String(f._id)}`);

        await run(true);

        expect(order.slice(0, 1)).toEqual(['marker']);
        const s1 = progressId('sales', 's1');
        expect(order.indexOf(`progress ${s1}`)).toBeLessThan(
            order.indexOf('write s1'),
        );
        expect(order.at(-1)).toBe('marker');
    });

    it('refuses another apply once complete: it would decode twice', async () => {
        await run(true);

        const again = await run(true);

        expect(again.exitCode).toBe(1);
        expect(again.lines[0]).toMatch(/^Refusing: .*already complete/);
        expect(reversal()).toBe('typed &lt; literally');
        // A dry run afterwards still works, with a warning.
        const dry = await run(false);
        expect(dry.exitCode).toBe(0);
        expect(dry.lines[0]).toMatch(/^WARNING: /);
    });

    describe('a crash mid-apply', () => {
        const crash = new Error('process killed');

        /**
         * Kills the run at the Sales document, after products were written.
         * 'before-write': dies right after s1's progress record is stored,
         * before the document write. 'after-write': s1 is written but its
         * `done` mark fails, and the process dies at the next document.
         */
        async function crashAt(where: 'before-write' | 'after-write') {
            const s1 = progressId('sales', 's1');
            const h1 = progressId('shift', 'h1');
            if (where === 'before-write') {
                progress.afterWrite = (filter) => {
                    if (filter._id === s1) throw crash;
                };
            } else {
                progress.beforeWrite = (filter) => {
                    const earlier = progress.writes.filter((w) => w._id === s1);
                    if (filter._id === s1 && earlier.length === 1) {
                        throw new Error('network blip');
                    }
                    if (filter._id === h1) throw crash;
                };
            }
            await expect(run(true)).rejects.toBe(crash);
            progress.afterWrite = undefined;
            progress.beforeWrite = undefined;
        }

        it('leaves the marker running and the edit recorded', async () => {
            await crashAt('before-write');

            expect(marker().status).toBe('running');
            expect(collections.Product.rows[0].name).toBe('m&m peanut');
            expect(reversal()).toBe('typed &amp;lt; literally');
            expect(
                progress.rows.find((r) => r._id === progressId('sales', 's1'))
                    ?.status,
            ).toBe('pending');
        });

        it.each(['before-write', 'after-write'] as const)(
            'crashed %s: a rerun finishes without decoding anything twice',
            async (where) => {
                await crashAt(where);

                // The dead run still holds the lock.
                const plain = await run(true);
                expect(plain.exitCode).toBe(1);
                expect(plain.lines[0]).toMatch(/--resume-stale/);

                const rerun = await run(true, true);

                expect(rerun.exitCode).toBe(0);
                expect(rerun.lines[0]).toMatch(/^Resuming: /);
                // Decoded exactly once: `&lt;`, not `<`.
                expect(reversal()).toBe('typed &lt; literally');
                expect(collections.Product.rows[0].name).toBe('m&m peanut');
                expect(drop()).toBe('drop > 5k');
                expect(marker().status).toBe('complete');
                expect(rerun.lines).toContain(
                    '  already decoded by an earlier run: 1',
                );
            },
        );
    });

    it('a failed write exits 1, stays incomplete, and a rerun retries only it', async () => {
        collections.Sales.throwOn.set('s1', new Error('boom'));

        const first = await run(true);

        expect(first.exitCode).toBe(1);
        expect(first.failed).toBe(1);
        expect(first.lines).toContain(
            '  FAILED sales s1: boom (a rerun retries it)',
        );
        expect(marker().status).toBe('incomplete');
        // Everything else was still written.
        expect(drop()).toBe('drop > 5k');

        collections.Sales.throwOn.clear();
        const productWrites = collections.Product.writes.length;
        const retry = await run(true);

        expect(retry.exitCode).toBe(0);
        expect(reversal()).toBe('typed &lt; literally');
        expect(drop()).toBe('drop > 5k');
        expect(collections.Product.writes.length).toBe(productWrites);
        expect(marker()).toMatchObject({
            status: 'complete',
            runs: [
                expect.objectContaining({ runId: 'run-1', failed: 1 }),
                expect.objectContaining({ runId: 'run-2', written: 1 }),
            ],
        });
    });

    it('skips a document changed since it was read, and carries on', async () => {
        collections.Sales.beforeWrite = (filter) => {
            if (filter._id === 's1') {
                (
                    collections.Sales.rows[0].discount as { reason: string }
                ).reason = 'edited meanwhile';
            }
        };

        const outcome = await run(true);

        expect(outcome.exitCode).toBe(0);
        expect(collections.Sales.rows[0].discount).toEqual({
            reason: 'edited meanwhile',
        });
        expect(outcome.lines).toContain(
            '  SKIPPED sales s1: changed since it was read; check it by hand',
        );
        expect(drop()).toBe('drop > 5k');
        expect(outcome.skipped).toBe(2);
    });

    it('reports a duplicate-key race as a skipped collision', async () => {
        collections.Product.throwOn.set(
            'p1',
            Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
        );

        const outcome = await run(true);

        expect(outcome.exitCode).toBe(0);
        expect(outcome.lines).toContain(
            '  SKIPPED p1 (name): "m&amp;m peanut" -> "m&m peanut" would duplicate (unique index); rename one of them by hand',
        );
        expect(outcome.skipped).toBe(2);
    });

    /** A pause point: `reached` resolves when a run hits it, `open` lets it on. */
    function pausePoint() {
        let reach!: () => void;
        let release!: () => void;
        const reached = new Promise<void>((r) => (reach = r));
        const released = new Promise<void>((r) => (release = r));
        return {
            reached,
            open: () => release(),
            wait: () => {
                reach();
                return released;
            },
        };
    }

    describe('two runs at once', () => {
        it('the second refuses while the first is between its reads, and nothing is decoded twice', async () => {
            // Run 1 pauses in the Sales pass after reading its progress
            // records and before reading the candidates.
            const pause = pausePoint();
            let paused = false;
            collections.Sales.beforeFind = async (filter) => {
                if ('$or' in filter && !paused) {
                    paused = true;
                    await pause.wait();
                }
            };
            const first = run(true);
            await pause.reached;

            const second = await run(true);

            expect(second.exitCode).toBe(1);
            expect(second.lines[0]).toMatch(
                /^Refusing: .* is being applied by run run-1 on host:1, started .*--resume-stale/,
            );
            pause.open();
            expect((await first).exitCode).toBe(0);
            // Decoded exactly once.
            expect(reversal()).toBe('typed &lt; literally');
            expect(marker().status).toBe('complete');
            expect(marker().runs).toHaveLength(1);
        });

        it('two first runs racing to create the marker: one wins, one refuses', async () => {
            // Run 1 has read "no marker" but not claimed it yet.
            const read = pausePoint();
            migrations.afterFind = async () => {
                migrations.afterFind = undefined;
                await read.wait();
            };
            const first = run(true);
            await read.reached;
            // Run 2 claims the marker and pauses mid-run.
            const mid = pausePoint();
            collections.Sales.beforeFind = async (filter) => {
                if ('$or' in filter) {
                    collections.Sales.beforeFind = undefined;
                    await mid.wait();
                }
            };
            const second = run(true);
            await mid.reached;

            read.open();
            const firstOutcome = await first;
            mid.open();

            expect(firstOutcome.exitCode).toBe(1);
            expect(firstOutcome.lines[0]).toMatch(
                /is being applied by run run-2/,
            );
            expect((await second).exitCode).toBe(0);
            expect(reversal()).toBe('typed &lt; literally');
        });

        it('a dry run next to a live run only warns', async () => {
            const pause = pausePoint();
            collections.Sales.beforeFind = async (filter) => {
                if ('$or' in filter) await pause.wait();
            };
            const first = run(true);
            await pause.reached;
            collections.Sales.beforeFind = undefined;

            const dry = await run(false);
            pause.open();
            await first;

            expect(dry.exitCode).toBe(0);
            expect(dry.lines[0]).toMatch(/^WARNING: a run holds the lock/);
        });
    });

    describe('collision chains on a unique name', () => {
        beforeEach(() => {
            collections.Product.unique = 'name';
            collections.Product.rows.splice(0);
            // A decodes to `&lt;x`, which B holds until B decodes to `<x`.
            collections.Product.rows.push(
                { _id: 'A', name: '&amp;lt;x' },
                { _id: 'B', name: '&lt;x' },
                // A genuine duplicate stays skipped.
                { _id: 'C', name: 'a&amp;b' },
                { _id: 'D', name: 'a&b' },
            );
        });

        it('--apply resolves the chain and skips only the real duplicate', async () => {
            const outcome = await run(true);

            expect(outcome.exitCode).toBe(0);
            expect(collections.Product.rows.map((r) => r.name)).toEqual([
                '&lt;x',
                '<x',
                'a&amp;b',
                'a&b',
            ]);
            expect(outcome.lines).toContain(
                '  SKIPPED C (name): "a&amp;b" -> "a&b" would duplicate D; rename one of them by hand',
            );
            expect(
                outcome.lines.filter((l) => l.startsWith('  SKIPPED')),
            ).toHaveLength(1);
            expect(outcome.reports[0].documents).toBe(2);
        });

        it('the dry run predicts the same', async () => {
            const outcome = await run(false);

            expect(outcome.reports[0].documents).toBe(2);
            expect(outcome.reports[0].collisions.map((c) => c._id)).toEqual([
                'C',
            ]);
        });
    });

    it('a landed write whose done-mark fails is a note, not a failure', async () => {
        const s1 = progressId('sales', 's1');
        progress.beforeWrite = (filter) => {
            const earlier = progress.writes.filter((w) => w._id === s1);
            if (filter._id === s1 && earlier.length === 1) {
                throw new Error('network blip');
            }
        };

        const outcome = await run(true);

        expect(outcome.exitCode).toBe(0);
        expect(outcome.failed).toBe(0);
        expect(outcome.lines).toContain(
            '  NOTE sales s1: written; its progress mark failed (network blip), a rerun will confirm it',
        );
        expect(reversal()).toBe('typed &lt; literally');
    });

    it('a resume leaves settled records alone, even if the document changed since', async () => {
        collections.Sales.throwOn.set('s1', new Error('boom'));
        expect((await run(true)).exitCode).toBe(1);
        collections.Sales.throwOn.clear();
        // p1 was decoded by run 1; someone renamed it afterwards.
        collections.Product.rows[0].name = 'renamed';

        const rerun = await run(true);

        expect(rerun.exitCode).toBe(0);
        expect(rerun.lines.join('\n')).not.toMatch(/SKIPPED product p1/);
        expect(rerun.lines).toContain('  already decoded by an earlier run: 1');
        expect(collections.Product.rows[0].name).toBe('renamed');
        expect(reversal()).toBe('typed &lt; literally');
    });
});

describe('progressState', () => {
    const changes = [{ path: 'a.b', from: 'x &amp; y', to: 'x & y' }];

    it.each([
        [{ a: { b: 'x & y' } }, 'done'],
        [{ a: { b: 'x &amp; y' } }, 'pending'],
        [{ a: { b: 'edited' } }, 'moved'],
        [undefined, 'moved'],
    ])('%j -> %s', (doc, state) => {
        expect(progressState(doc, changes)).toBe(state);
    });
});
