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
    planDocument,
    runMigration,
    stringsAt,
    summarize,
    TARGETS,
} from './decode-html-entities';

describe('decodeEntities', () => {
    it.each([
        // What the old pipe stored for the issue's example.
        ["M&amp;M's qty &lt; 10 a&gt;b", "M&M's qty < 10 a>b"],
        ['Tom &amp; Jerry', 'Tom & Jerry'],
        ['say &quot;hi&quot;', 'say "hi"'],
        ['plain text', 'plain text'],
        ['', ''],
    ])('%j -> %j', (stored, typed) => {
        expect(decodeEntities(stored)).toBe(typed);
    });

    it('decodes in a single pass: a typed entity stays an entity', () => {
        // The user typed `&lt;` and `&amp;`; the pipe stored them encoded.
        expect(decodeEntities('&amp;lt;')).toBe('&lt;');
        expect(decodeEntities('&amp;amp;')).toBe('&amp;');
        expect(decodeEntities('a &amp;lt;b&amp;gt; c')).toBe('a &lt;b&gt; c');
    });

    it('decodes double-encoded text by exactly one level', () => {
        const once = decodeEntities('&amp;amp;lt;');

        expect(once).toBe('&amp;lt;');
        // A second run WOULD go further, which is why apply runs only once.
        expect(decodeEntities(once)).toBe('&lt;');
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

/** Reads a concrete dotted path (`movements.1.reason`). */
function getPath(doc: unknown, path: string): unknown {
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

function setPath(doc: Row, path: string, value: string): void {
    const keys = path.split('.');
    const last = keys.pop()!;
    const parent = keys.reduce<Record<string, unknown>>(
        (node, key) => node[key] as Record<string, unknown>,
        doc,
    );
    parent[last] = value;
}

/**
 * An in-memory collection: `find` returns every row for the candidate
 * query (planDocument does the filtering) and honours `{field: {$in}}` for
 * the unique-owner lookup; `updateOne` matches `_id` plus old values.
 */
class FakeCollection implements MigrationCollection {
    /** Called before each write, to simulate concurrent changes. */
    beforeWrite?: (id: unknown) => void;
    /** Ids whose write throws this error. */
    readonly throwOn = new Map<string, unknown>();

    constructor(
        readonly collectionName: string,
        readonly rows: Row[],
    ) {}

    find(filter: Record<string, unknown>) {
        const rows = this.rows.filter((row) =>
            Object.entries(filter).every(([key, cond]) => {
                if (key === '$or') return true;
                const values = (cond as { $in: unknown[] }).$in;
                return values.includes(row[key]);
            }),
        );
        return { toArray: () => Promise.resolve(structuredClone(rows)) };
    }

    updateOne(
        filter: Record<string, unknown>,
        update: { $set: Record<string, string> },
    ) {
        this.beforeWrite?.(filter._id);
        const error = this.throwOn.get(String(filter._id));
        if (error) return Promise.reject(error as Error);
        const row = this.rows.find((r) =>
            Object.entries(filter).every(([path, value]) =>
                path === '_id'
                    ? String(r._id) === String(value)
                    : getPath(r, path) === value,
            ),
        );
        if (!row) return Promise.resolve({ matchedCount: 0 });
        for (const [path, value] of Object.entries(update.$set)) {
            setPath(row, path, value);
        }
        return Promise.resolve({ matchedCount: 1 });
    }
}

describe('runMigration', () => {
    let collections: Record<string, FakeCollection>;
    let applied: Record<string, unknown>[];

    const migrations = {
        findOne: ({ _id }: { _id: string }) =>
            Promise.resolve(applied.find((m) => m._id === _id) ?? null),
        insertOne: (doc: Record<string, unknown>) => {
            applied.push(doc);
            return Promise.resolve();
        },
    };

    function run(apply: boolean) {
        return runMigration({
            apply,
            migrations,
            collectionFor: (model) => collections[model],
        });
    }

    beforeEach(() => {
        applied = [];
        collections = Object.fromEntries(
            TARGETS.map((t) => [
                t.model,
                new FakeCollection(t.model.toLowerCase(), []),
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
        expect(applied).toEqual([]);
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

    it('--apply decodes, skips the collision and records itself', async () => {
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
        expect(getPath(collections.Shift.rows[0], 'movements.1.reason')).toBe(
            'drop > 5k',
        );
        expect(applied).toEqual([
            expect.objectContaining({
                _id: MIGRATION_ID,
                skipped: 1,
                documents: expect.objectContaining({
                    product: 1,
                    sales: 1,
                    shift: 1,
                }),
            }),
        ]);
    });

    it('refuses a second apply, which would decode twice', async () => {
        await run(true);
        const reversal = getPath(collections.Sales.rows[0], 'reversal.reason');

        const again = await run(true);

        expect(again.exitCode).toBe(1);
        expect(again.lines[0]).toMatch(/^Refusing: .*already applied/);
        expect(getPath(collections.Sales.rows[0], 'reversal.reason')).toBe(
            reversal,
        );
        // A dry run afterwards still works, with a warning.
        const dry = await run(false);
        expect(dry.exitCode).toBe(0);
        expect(dry.lines[0]).toMatch(/^WARNING: /);
    });

    it('skips a document changed since it was read, and carries on', async () => {
        collections.Sales.beforeWrite = (id) => {
            if (id === 's1') {
                (
                    collections.Sales.rows[0].discount as { reason: string }
                ).reason = 'edited meanwhile';
            }
        };

        const outcome = await run(true);

        expect(collections.Sales.rows[0].discount).toEqual({
            reason: 'edited meanwhile',
        });
        expect(outcome.lines).toContain(
            '  SKIPPED sales s1: changed since it was read; check it by hand',
        );
        // Later collections were still migrated.
        expect(getPath(collections.Shift.rows[0], 'movements.1.reason')).toBe(
            'drop > 5k',
        );
        expect(outcome.skipped).toBe(2);
    });

    it('reports a duplicate-key race and an unexpected error without stopping', async () => {
        collections.Product.throwOn.set(
            'p1',
            Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
        );
        collections.Sales.throwOn.set('s1', new Error('boom'));

        const outcome = await run(true);

        expect(outcome.lines).toEqual(
            expect.arrayContaining([
                '  SKIPPED p1 (name): "m&amp;m peanut" -> "m&m peanut" would duplicate (unique index); rename one of them by hand',
                '  FAILED sales s1: boom',
            ]),
        );
        expect(getPath(collections.Shift.rows[0], 'movements.1.reason')).toBe(
            'drop > 5k',
        );
        expect(outcome.skipped).toBe(3);
        expect(applied).toHaveLength(1);
    });
});
