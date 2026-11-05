import { Types } from 'mongoose';
import {
    OverrideAction,
    Role,
    StockCountStatus,
    STOCK_COUNT_LINE_SHAPE,
    STOCK_COUNT_SHAPE,
    UnitOfMeasure,
    wireShapeDiff,
    type StockCountView,
    type Receipt,
} from '@grocery-pos/contracts';
import {
    bootDbApp,
    caller,
    cashSale,
    openShift,
    read,
    seedProduct,
    seedSupplier,
    stockOf,
    type DbApp,
    type Caller,
} from './db-app';
import { approvalHeaders, ensureApprovalFixtures } from './approval-fixtures';
let db: DbApp;
const actor = caller('counter', Role.Adjuster),
    admin = caller('count-admin', Role.Admin),
    restocker = caller('count-restocker', Role.Restocker);
beforeAll(async () => {
    db = await bootDbApp();
    await ensureApprovalFixtures(db, actor);
    await ensureApprovalFixtures(db, admin);
});
afterAll(async () => db?.close());
async function create(products: string[], who: Caller = actor) {
    const result = await read<StockCountView>(
        await db.call(who, 'POST', '/stock-counts', {
            scope: 'products',
            products,
        }),
    );
    expect(result.status).toBe(201);
    return result.body;
}
async function save(count: StockCountView, quantities: (number | undefined)[]) {
    const result = await read<StockCountView>(
        await db.call(actor, 'PATCH', `/stock-counts/${count._id}`, {
            version: count.version,
            lines: count.lines.flatMap((line, i) =>
                quantities[i] === undefined
                    ? []
                    : [{ line: line._id, countedQty: quantities[i] }],
            ),
        }),
    );
    expect(result.status).toBe(200);
    return result.body;
}
async function submit(count: StockCountView) {
    const result = await read<StockCountView>(
        await db.call(actor, 'POST', `/stock-counts/${count._id}/submit`, {
            version: count.version,
        }),
    );
    expect(result.status).toBe(201);
    return result.body;
}
async function approve(
    count: StockCountView,
    headers?: Record<string, string>,
) {
    return read<StockCountView>(
        await db.call(
            actor,
            'POST',
            `/stock-counts/${count._id}/approve`,
            { version: count.version },
            headers ??
                (await approvalHeaders(db, actor, OverrideAction.STOCK_COUNT, {
                    stockCount: { countId: count._id, version: count.version },
                })),
        ),
    );
}
it('persists partial progress with optimistic versions, explicit zero, contracts and role boundaries', async () => {
    const a = await seedProduct(db, 100, 10),
        b = await seedProduct(db, 200, 5);
    let count = await create([a, b]);
    expect(wireShapeDiff(count, STOCK_COUNT_SHAPE)).toEqual({
        missing: [],
        unexpected: [],
    });
    for (const line of count.lines)
        expect(wireShapeDiff(line, STOCK_COUNT_LINE_SHAPE)).toEqual({
            missing: [],
            unexpected: [],
        });
    const old = count;
    count = await save(
        count,
        count.lines.map((line) => (line.product === a ? 0 : undefined)),
    );
    const reloaded = await read<StockCountView>(
        await db.call(actor, 'GET', `/stock-counts/${count._id}`),
    );
    expect(
        reloaded.body.lines.find((line) => line.product === a)?.countedQty,
    ).toBe(0);
    expect(
        reloaded.body.lines.find((line) => line.product === b)?.countedQty,
    ).toBeUndefined();
    expect(
        (
            await db.call(actor, 'POST', `/stock-counts/${count._id}/submit`, {
                version: count.version,
            })
        ).status,
    ).toBe(400);
    expect(
        (
            await db.call(actor, 'PATCH', `/stock-counts/${count._id}`, {
                version: old.version,
                lines: [{ line: old.lines[0]._id, countedQty: 9 }],
            })
        ).status,
    ).toBe(409);
    expect(
        (await db.call(restocker, 'POST', '/stock-counts', { scope: 'all' }))
            .status,
    ).toBe(403);
    expect(
        (
            await db.call(
                caller('count-supervisor', Role.Supervisor),
                'GET',
                '/stock-counts?page=1&limit=20',
            )
        ).status,
    ).toBe(403);
    expect(
        (await db.call(actor, 'GET', '/stock-counts?page=1&limit=101')).status,
    ).toBe(400);
});
it('applies opening variance to current balance after all intervening changes and posts exactly one adjustment', async () => {
    const product = await seedProduct(db, 100, 10);
    let count = await create([product]);
    count = await submit(await save(count, [8]));
    const shift = await db.call(actor, 'POST', '/adjustments', {
        description: 'Receipt/correction after opening',
        adjustDetails: [{ product, change: 5, reason: 'late stock' }],
    });
    expect(shift.status).toBe(201);
    const result = await approve(count);
    expect(result.status).toBe(201);
    expect(result.body.status).toBe(StockCountStatus.APPROVED);
    expect(await stockOf(db, product)).toBe(13);
    expect(result.body.adjustment).toBeDefined();
    expect(result.body.approvedBy?.name).toBe('fixture-approval-admin');
    const details = await db
        .model<{ change: number }>('AdjustmentDetails')
        .find({ adjustment: result.body.adjustment })
        .lean();
    expect(details).toHaveLength(1);
    expect(details[0].change).toBe(-2);
    const retry = await read<StockCountView>(
        await db.call(actor, 'POST', `/stock-counts/${count._id}/approve`, {
            version: count.version,
        }),
    );
    expect(retry.status).toBe(201);
    expect(retry.body.adjustment).toBe(result.body.adjustment);
    expect(await stockOf(db, product)).toBe(13);
});
it('requires exact manager context, cancellation invalidates tokens and nonnegative failure rolls back the whole adjustment/grant', async () => {
    const a = await seedProduct(db, 100, 10),
        b = await seedProduct(db, 100, 10);
    let count = await create([a, b]);
    count = await submit(await save(count, [0, 9]));
    expect(
        (
            await db.call(actor, 'POST', `/stock-counts/${count._id}/approve`, {
                version: count.version,
            })
        ).status,
    ).toBe(403);
    const token = await approvalHeaders(db, actor, OverrideAction.STOCK_COUNT, {
        stockCount: { countId: count._id, version: count.version },
    });
    await db.call(actor, 'POST', '/adjustments', {
        description: 'Sold stock',
        adjustDetails: [{ product: a, change: -1, reason: 'movement' }],
    });
    expect((await approve(count, token)).status).toBe(400);
    expect(await stockOf(db, a)).toBe(9);
    expect(await stockOf(db, b)).toBe(10);
    const unchanged = await read<StockCountView>(
        await db.call(actor, 'GET', `/stock-counts/${count._id}`),
    );
    expect(unchanged.body.status).toBe(StockCountStatus.SUBMITTED);
    expect(unchanged.body.adjustment).toBeUndefined();
    await db.call(actor, 'POST', '/adjustments', {
        description: 'Return stock',
        adjustDetails: [{ product: a, change: 1, reason: 'return' }],
    });
    expect((await approve(count, token)).status).toBe(201);
    let cancelled = await create([b]);
    cancelled = await submit(await save(cancelled, [10]));
    const oldToken = await approvalHeaders(
        db,
        actor,
        OverrideAction.STOCK_COUNT,
        { stockCount: { countId: cancelled._id, version: cancelled.version } },
    );
    expect(
        (
            await db.call(
                actor,
                'POST',
                `/stock-counts/${cancelled._id}/cancel`,
                { version: cancelled.version },
            )
        ).status,
    ).toBe(201);
    expect((await approve(cancelled, oldToken)).status).toBe(409);
});
it('approves fifty products as one adjustment containing only nonzero lines, and handles all-zero variances without empty history', async () => {
    const products = [];
    for (let i = 0; i < 50; i++) products.push(await seedProduct(db, 100, 10));
    let count = await create(products);
    count = await submit(
        await save(
            count,
            count.lines.map((_, i) => (i % 2 ? 10 : 9)),
        ),
    );
    const result = await approve(count);
    expect(result.status).toBe(201);
    expect(
        await db
            .model('AdjustmentDetails')
            .countDocuments({ adjustment: result.body.adjustment }),
    ).toBe(25);
    const zeroId = await seedProduct(db, 100, 0);
    let zero = await create([zeroId]);
    zero = await submit(await save(zero, [0]));
    const before = await db.model('Adjustment').countDocuments();
    const approved = await approve(zero);
    expect(approved.status).toBe(201);
    expect(approved.body.adjustment).toBeUndefined();
    expect(await db.model('Adjustment').countDocuments()).toBe(before);
});
it('serializes concurrent approvals and stock movements without duplicate posting', async () => {
    const product = await seedProduct(db, 100, 100);
    let count = await create([product]);
    count = await submit(await save(count, [90]));
    const headers = await approvalHeaders(
        db,
        actor,
        OverrideAction.STOCK_COUNT,
        { stockCount: { countId: count._id, version: count.version } },
    );
    const [a, b, movement] = await Promise.all([
        approve(count, headers),
        approve(count, headers),
        db.call(actor, 'POST', '/adjustments', {
            description: 'parallel movement',
            adjustDetails: [{ product, change: 5, reason: 'receipt' }],
        }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(movement.status).toBe(201);
    expect(a.body.adjustment).toBe(b.body.adjustment);
    expect(await stockOf(db, product)).toBe(95);
});
it('counts tracked measured stock per batch and preserves later FEFO consumption, expired lots and batch sum', async () => {
    const product = await seedProduct(db, 18000, 0);
    await db
        .model('Product')
        .collection.updateOne(
            { _id: new Types.ObjectId(product) },
            { $set: { unit: UnitOfMeasure.KG, tracksExpiry: true } },
        );
    const supplier = await seedSupplier(db);
    expect(
        (
            await db.call(restocker, 'POST', '/restocks', {
                supplier,
                description: 'count batches',
                restockDetails: [
                    {
                        product,
                        quantity: 1000,
                        unitCost: 10000,
                        expiryDate: '2099-01-01',
                        batchNo: 'A',
                    },
                    {
                        product,
                        quantity: 500,
                        unitCost: 10000,
                        expiryDate: '2000-01-01',
                        batchNo: 'expired',
                    },
                ],
            })
        ).status,
    ).toBe(201);
    let count = await create([product]);
    expect(count.lines).toHaveLength(2);
    count = await submit(
        await save(
            count,
            count.lines.map((line) => (line.batchNo === 'A' ? 900 : 0)),
        ),
    );
    expect((await approve(count)).status).toBe(201);
    expect(await stockOf(db, product)).toBe(900);
    const lots = await db
        .model<{ remainingQty: number }>('InventoryBatch')
        .find({ product })
        .lean();
    expect(lots.reduce((sum, row) => sum + row.remainingQty, 0)).toBe(900);
    expect(lots.filter((lot) => lot.remainingQty === 0)).toHaveLength(1);
});
it('preserves sales, receipts and refunds after the opening reference instead of overwriting current stock', async () => {
    const product = await seedProduct(db, 100, 10),
        supplier = await seedSupplier(db),
        seller = caller('count-moving-seller', Role.Seller);
    await openShift(db, seller);
    let count = await create([product]);
    count = await submit(await save(count, [8]));
    const sold = await read<Receipt>(
        await db.call(seller, 'POST', '/sales', cashSale(product, 3, 300)),
    );
    expect(sold.status).toBe(201);
    expect(
        (
            await db.call(restocker, 'POST', '/restocks', {
                supplier,
                description: 'delivery while counting',
                restockDetails: [{ product, quantity: 5, unitCost: 30 }],
            })
        ).status,
    ).toBe(201);
    const refund = await approvalHeaders(db, admin, OverrideAction.REFUND, {
        reversal: {
            saleId: sold.body._id,
            reason: 'Returned while counting',
        },
    });
    expect(
        (
            await db.call(
                admin,
                'POST',
                `/sales/${sold.body._id}/refund`,
                { reason: 'Returned while counting' },
                refund,
            )
        ).status,
    ).toBe(201);
    expect(await stockOf(db, product)).toBe(15);
    expect((await approve(count)).status).toBe(201);
    expect(await stockOf(db, product)).toBe(13);
});
it('rejects cross-count tokens, demoted approvers and requester role changes without losing the pending count', async () => {
    const product = await seedProduct(db, 100, 10);
    let a = await create([product]),
        b = await create([product]);
    a = await submit(await save(a, [9]));
    b = await submit(await save(b, [9]));
    const token = await approvalHeaders(db, actor, OverrideAction.STOCK_COUNT, {
        stockCount: { countId: a._id, version: a.version },
    });
    expect((await approve(b, token)).status).toBe(403);
    const manager = await db
        .model('User')
        .findOne({ name: 'fixture-approval-admin' })
        .lean();
    await db
        .model('User')
        .updateOne({ _id: manager!._id }, { $set: { roles: [Role.Seller] } });
    expect((await approve(a, token)).status).toBe(403);
    expect(await stockOf(db, product)).toBe(10);
    await db
        .model('User')
        .updateOne({ _id: manager!._id }, { $set: { roles: [Role.Admin] } });
    await db
        .model('User')
        .updateOne(
            { _id: new Types.ObjectId(actor.userId) },
            { $set: { roles: [Role.Restocker] } },
        );
    expect((await approve(a, token)).status).toBe(403);
    await db
        .model('User')
        .updateOne(
            { _id: new Types.ObjectId(actor.userId) },
            { $set: { roles: [Role.Adjuster] } },
        );
});
it('refuses expired approval and changed tracking; supports category scope and guards scope/body tampering', async () => {
    const product = await seedProduct(db, 100, 0);
    const category = await db
        .model<{ name: string; nameKey: string }>('Category')
        .create({
            name: 'Count scope',
            nameKey: 'count scope',
            isActive: true,
            sortOrder: 0,
        });
    await db
        .model('Product')
        .collection.updateOne(
            { _id: new Types.ObjectId(product) },
            { $set: { category: category._id } },
        );
    const scoped = await read<StockCountView>(
        await db.call(actor, 'POST', '/stock-counts', {
            scope: 'category',
            category: String(category._id),
        }),
    );
    expect(scoped.status).toBe(201);
    expect(scoped.body.lines.map((line) => line.product)).toEqual([product]);
    expect(
        (
            await db.call(actor, 'POST', '/stock-counts', {
                scope: 'all',
                products: [product],
            })
        ).status,
    ).toBe(400);
    let count = await create([product]);
    count = await submit(await save(count, [0]));
    const token = await approvalHeaders(db, actor, OverrideAction.STOCK_COUNT, {
        stockCount: { countId: count._id, version: count.version },
    });
    await db
        .model('OverrideGrant')
        .updateMany(
            { action: OverrideAction.STOCK_COUNT, consumedAt: null },
            { $set: { expiresAt: new Date(0) } },
        );
    expect((await approve(count, token)).status).toBe(403);
    const fresh = await approvalHeaders(db, actor, OverrideAction.STOCK_COUNT, {
        stockCount: { countId: count._id, version: count.version },
    });
    expect(
        (
            await db.call(restocker, 'PATCH', '/products', {
                updates: [{ product, update: { tracksExpiry: true } }],
            })
        ).status,
    ).toBe(200);
    expect((await approve(count, fresh)).status).toBe(400);
});
it('fails atomically if intervening batch consumption makes a lot variance invalid despite enough aggregate stock', async () => {
    const product = await seedProduct(db, 18000, 0);
    await db
        .model('Product')
        .collection.updateOne(
            { _id: new Types.ObjectId(product) },
            { $set: { unit: UnitOfMeasure.KG, tracksExpiry: true } },
        );
    const supplier = await seedSupplier(db);
    expect(
        (
            await db.call(restocker, 'POST', '/restocks', {
                supplier,
                description: 'batch count race',
                restockDetails: [
                    {
                        product,
                        quantity: 1000,
                        unitCost: 10000,
                        expiryDate: '2098-01-01',
                        batchNo: 'earliest',
                    },
                    {
                        product,
                        quantity: 1000,
                        unitCost: 10000,
                        expiryDate: '2099-01-01',
                        batchNo: 'later',
                    },
                ],
            })
        ).status,
    ).toBe(201);
    let count = await create([product]);
    count = await submit(
        await save(
            count,
            count.lines.map((line) => (line.batchNo === 'earliest' ? 0 : 1000)),
        ),
    );
    const seller = caller('count-batch-moving-seller', Role.Seller);
    await openShift(db, seller);
    expect(
        (await db.call(seller, 'POST', '/sales', cashSale(product, 500, 9000)))
            .status,
    ).toBe(201);
    expect((await approve(count)).status).toBe(400);
    expect(await stockOf(db, product)).toBe(1500);
    const saved = await read<StockCountView>(
        await db.call(actor, 'GET', `/stock-counts/${count._id}`),
    );
    expect(saved.body.adjustment).toBeUndefined();
    expect(saved.body.status).toBe(StockCountStatus.SUBMITTED);
    const lots = await db
        .model<{ remainingQty: number }>('InventoryBatch')
        .find({ product })
        .lean();
    expect(lots.reduce((sum, line) => sum + line.remainingQty, 0)).toBe(1500);
});
