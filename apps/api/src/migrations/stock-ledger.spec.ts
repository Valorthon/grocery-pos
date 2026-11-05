import { Types } from 'mongoose';
import { migrateStockLedger, STOCK_LEDGER_MIGRATION } from './stock-ledger';

type Doc = Record<string, unknown>;
const product = new Types.ObjectId(),
    actor = new Types.ObjectId(),
    restock = new Types.ObjectId(),
    sale = new Types.ObjectId(),
    adjustment = new Types.ObjectId(),
    count = new Types.ObjectId();
const date = new Date('2026-01-01T00:00:00Z');
const equal = (a: unknown, b: unknown) =>
    a instanceof Types.ObjectId || b instanceof Types.ObjectId
        ? String(a) === String(b)
        : a === b;
function fixture() {
    const data = new Map<string, Doc[]>([
        ['products', [{ _id: product, unit: 'PIECE' }]],
        [
            'inventories',
            [
                {
                    _id: new Types.ObjectId(),
                    product,
                    stock: 10,
                    createdAt: date,
                },
            ],
        ],
        ['restocks', [{ _id: restock, createdAt: date, restockedBy: actor }]],
        [
            'restockdetails',
            [{ _id: new Types.ObjectId(), restock, product, quantity: 5 }],
        ],
        [
            'adjustments',
            [{ _id: adjustment, createdAt: date, adjustedBy: actor }],
        ],
        [
            'adjustmentdetails',
            [{ _id: new Types.ObjectId(), adjustment, product, change: -1 }],
        ],
        [
            'sales',
            [
                {
                    _id: sale,
                    createdAt: date,
                    soldAt: new Date('2025-12-30'),
                    cashier: actor,
                    reversal: {
                        type: 'VOID',
                        at: new Date('2026-01-02'),
                        approvedBy: actor,
                    },
                },
            ],
        ],
        [
            'salesdetails',
            [{ _id: new Types.ObjectId(), sales: sale, product, quantity: 2 }],
        ],
        ['stockcounts', [{ _id: count, adjustment }]],
        ['migrations', []],
        ['stockmovements', []],
    ]);
    const writes = jest.fn();
    function matches(doc: Doc, filter: Doc) {
        return Object.entries(filter).every(([key, value]) =>
            typeof value === 'object' && value !== null && '$exists' in value
                ? (doc[key] !== undefined) ===
                  (value as { $exists: boolean }).$exists
                : equal(doc[key], value),
        );
    }
    const raw = {
        collection: (name: string) => {
            if (!data.has(name)) data.set(name, []);
            const rows = data.get(name)!;
            return {
                find: (filter: Doc) => ({
                    toArray: async () =>
                        rows.filter((row) => matches(row, filter)),
                    async *[Symbol.asyncIterator]() {
                        for (const row of rows.filter((row) =>
                            matches(row, filter),
                        ))
                            yield row;
                    },
                }),
                findOne: async (filter: Doc) =>
                    rows.find((row) => matches(row, filter)) ?? null,
                updateOne: async (
                    filter: Doc,
                    update: { $set?: Doc; $inc?: Record<string, number> },
                    options?: { upsert?: boolean },
                ) => {
                    writes(name, 'update');
                    let doc = rows.find((row) => matches(row, filter));
                    let upsertedCount = 0;
                    if (!doc && options?.upsert) {
                        doc = { _id: filter._id };
                        rows.push(doc);
                        upsertedCount = 1;
                    }
                    if (doc) {
                        Object.assign(doc, update.$set);
                        for (const [k, v] of Object.entries(update.$inc ?? {}))
                            doc[k] = Number(doc[k] ?? 0) + v;
                    }
                    return {
                        matchedCount: doc && !upsertedCount ? 1 : 0,
                        upsertedCount,
                    };
                },
                insertMany: async (docs: Doc[]) => {
                    writes(name, 'insert');
                    rows.push(
                        ...docs.map((doc) => ({
                            _id: new Types.ObjectId(),
                            ...doc,
                        })),
                    );
                },
                insertOne: async (doc: Doc) => {
                    writes(name, 'insert');
                    rows.push({ _id: new Types.ObjectId(), ...doc });
                },
            };
        },
    };
    const session = {
        withTransaction: async (fn: () => unknown) => fn(),
        endSession: jest.fn(),
    };
    const model = jest.fn(() => ({
        init: jest.fn().mockResolvedValue(undefined),
    }));
    const connection = { db: raw, model, startSession: async () => session };
    const run = (apply = false, resume = false) =>
        migrateStockLedger(connection as never, apply, resume);
    return {
        data,
        writes,
        model,
        session,
        connection,
        run,
        rows: (name: string) => data.get(name)!,
    };
}
describe('historical stock-ledger reconstruction safety', () => {
    it('previews known events and opening gap with no writes or model initialization', async () => {
        const f = fixture();
        const plan = await f.run();
        expect(plan[0]).toMatchObject({
            stock: 10,
            knownNet: 4,
            opening: 6,
            events: 4,
        });
        expect(f.writes).not.toHaveBeenCalled();
        expect(f.model).not.toHaveBeenCalled();
    });
    it('reconstructs all source types, unknown identities and stable tie ordering, then safely reruns', async () => {
        const f = fixture();
        f.rows('restocks')[0].restockedBy = undefined;
        await f.run(true);
        const rows = f.rows('stockmovements');
        expect(rows.map((r) => r.type)).toEqual([
            'OPENING',
            'RESTOCK',
            'COUNT',
            'SALE',
            'VOID',
        ]);
        expect(rows[0].quantity).toBe(6);
        expect(rows[1].user).toBeUndefined();
        expect(rows.at(-1)?.balanceAfter).toBe(10);
        expect(f.session.endSession).toHaveBeenCalled();
        const ids = rows.map((r) => r._id);
        await f.run(true);
        expect(rows.map((r) => r._id)).toEqual(ids);
    });
    it('keeps ordinary adjustments separate from count adjustments and handles refund facts', async () => {
        const f = fixture();
        f.rows('stockcounts').splice(0);
        f.rows('sales')[0].reversal = { type: 'REFUND', at: date };
        await f.run(true);
        expect(f.rows('stockmovements').map((r) => r.type)).toContain(
            'ADJUSTMENT',
        );
        expect(f.rows('stockmovements').map((r) => r.type)).toContain('REFUND');
    });
    it('keeps an empty-history opening explicitly unattributed and defaults missing unit to PIECE', async () => {
        const f = fixture();
        for (const key of [
            'restockdetails',
            'adjustmentdetails',
            'salesdetails',
        ])
            f.rows(key).splice(0);
        delete f.rows('products')[0].unit;
        await f.run(true);
        expect(f.rows('stockmovements')).toHaveLength(1);
        expect(f.rows('stockmovements')[0]).toMatchObject({
            quantity: 10,
            unit: 'PIECE',
            sequence: 0,
            refModel: 'Opening',
        });
        expect(f.rows('stockmovements')[0].user).toBeUndefined();
    });
    it.each(['running'])(
        'refuses an active %s lock except explicit stale takeover',
        async (status) => {
            const f = fixture();
            f.rows('migrations').push({
                _id: STOCK_LEDGER_MIGRATION,
                status,
                owner: 'old',
            });
            await expect(f.run(true)).rejects.toThrow('already running');
            await f.run(true, true);
            expect(f.rows('migrations')[0].status).toBe('complete');
        },
    );
    it('rejects concurrent lock loss before writing a ledger', async () => {
        const f = fixture();
        f.rows('migrations').push({
            _id: STOCK_LEDGER_MIGRATION,
            status: 'complete',
            owner: 'old',
        });
        const raw = f.connection.db;
        const original = raw.collection;
        raw.collection = (name: string) => {
            const c = original(name);
            if (name === 'migrations')
                c.updateOne = async () => ({
                    matchedCount: 0,
                    upsertedCount: 0,
                });
            return c;
        };
        await expect(f.run(true)).rejects.toThrow('Another migration process');
        expect(f.rows('stockmovements')).toHaveLength(0);
    });
    it.each(['restocks', 'adjustments', 'sales'])(
        'refuses orphan source details whose %s parent is missing',
        async (parent) => {
            const f = fixture();
            f.rows(parent).splice(0);
            await expect(f.run(true)).rejects.toThrow('Missing');
            expect(f.rows('migrations')[0].status).toBe('incomplete');
        },
    );
    it.each([NaN, 0.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects unsafe persisted stock %s',
        async (stock) => {
            const f = fixture();
            f.rows('inventories')[0].stock = stock;
            await expect(f.run()).rejects.toThrow('Unsafe historical');
        },
    );
    it('refuses missing products and unsupported units instead of making an opening', async () => {
        const f = fixture();
        f.rows('products')[0].unit = 'TONNE';
        await expect(f.run()).rejects.toThrow(
            'Unknown historical product unit',
        );
        f.rows('products').splice(0);
        await expect(f.run()).rejects.toThrow('Orphan inventory');
    });
    it('refuses live ledger overwrite before history import', async () => {
        const f = fixture();
        f.rows('stockmovements').push({ product, historical: false });
        await expect(f.run(true)).rejects.toThrow('Live ledger already exists');
    });
    it('rejects altered historical source facts after a successful import', async () => {
        const f = fixture();
        await f.run(true);
        f.rows('restockdetails')[0].quantity = 4;
        await expect(f.run(true)).rejects.toThrow('Historical source changed');
    });
    it('detects tampered imported quantities despite unchanged source facts', async () => {
        const f = fixture();
        await f.run(true);
        f.rows('stockmovements')[0].quantity = 99;
        await expect(f.run(true)).rejects.toThrow('Existing ledger changed');
    });
    it('rejects an unknown reversal type and missing event timestamps', async () => {
        const f = fixture();
        f.rows('sales')[0].reversal = { type: 'MAGIC', at: date };
        await expect(f.run()).rejects.toThrow('Unknown historical reversal');
        f.rows('sales')[0].reversal = undefined;
        f.rows('sales')[0].createdAt = undefined;
        await expect(f.run()).rejects.toThrow(
            'Missing historical event timestamp',
        );
    });
    it('uses exact integer sums and rejects an opening overflow', async () => {
        const f = fixture();
        f.rows('inventories')[0].stock = Number.MIN_SAFE_INTEGER;
        await expect(f.run()).rejects.toThrow(
            'Historical movement sum exceeds',
        );
    });
    it('does not guess an unsafe derived historical balance', async () => {
        const f = fixture();
        f.rows('inventories')[0].stock = Number.MAX_SAFE_INTEGER;
        f.rows('restockdetails')[0].quantity = Number.MAX_SAFE_INTEGER;
        f.rows('adjustmentdetails')[0].change = -Number.MAX_SAFE_INTEGER;
        f.rows('salesdetails').splice(0);
        await expect(f.run(true)).rejects.toThrow(
            'Derived historical balance exceeds',
        );
    });
    it('fails when history changes after the read-only plan before the product transaction', async () => {
        const f = fixture();
        f.connection.startSession = async () => {
            f.rows('restockdetails')[0].quantity = 6;
            return f.session;
        };
        await expect(f.run(true)).rejects.toThrow('History changed');
        expect(f.session.endSession).toHaveBeenCalled();
    });
    it('fails when inventory changes before transaction snapshot', async () => {
        const f = fixture();
        f.connection.startSession = async () => {
            f.rows('inventories')[0] = {
                ...f.rows('inventories')[0],
                stock: 11,
            };
            return f.session;
        };
        await expect(f.run(true)).rejects.toThrow('Inventory changed');
    });
    it('requires a connected database', async () => {
        await expect(migrateStockLedger({} as never, false)).rejects.toThrow(
            'Not connected',
        );
    });
});
