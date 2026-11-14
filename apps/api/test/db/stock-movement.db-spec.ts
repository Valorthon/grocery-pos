import { randomUUID } from 'node:crypto';
import { Types, type InsertManyOptions } from 'mongoose';
import {
    Role,
    OverrideAction,
    StockMovementType,
    UnitOfMeasure,
    STOCK_MOVEMENT_SHAPE,
    wireShapeDiff,
    type Paginated,
    type StockMovementView,
    type StockIntegrityView,
} from '@grocery-pos/contracts';
import {
    bootDbApp,
    caller,
    read,
    seedProduct,
    seedSupplier,
    openShift,
    cashSale,
    stockOf,
    type DbApp,
} from './db-app';
import { approvalHeaders, ensureApprovalFixtures } from './approval-fixtures';
import { StockMovement } from '../../src/stock-movement/stock-movement.schema';
let db: DbApp, supplier: string;
const admin = caller('ledger-admin', Role.Admin),
    restocker = caller('ledger-restocker', Role.Restocker),
    adjuster = caller('ledger-adjuster', Role.Adjuster),
    seller = caller('ledger-cashier', Role.Seller);
beforeAll(async () => {
    db = await bootDbApp();
    supplier = await seedSupplier(db);
    await openShift(db, seller);
    await ensureApprovalFixtures(db, adjuster);
});
afterAll(async () => {
    await db?.close();
});
async function movements(product: string, who = admin, query = '') {
    const result = await read<Paginated<StockMovementView>>(
        await db.call(
            who,
            'GET',
            `/products/${product}/movements?page=1&limit=100${query}`,
        ),
    );
    expect(result.status).toBe(200);
    for (const row of result.body.data)
        expect(wireShapeDiff(row, STOCK_MOVEMENT_SHAPE)).toEqual({
            missing: [],
            unexpected: [],
        });
    return result.body;
}
async function assertMatches(product: string) {
    const check = await read<StockIntegrityView>(
        await db.call(admin, 'GET', `/products/${product}/movements/integrity`),
    );
    expect(check.status).toBe(200);
    expect(check.body.matches).toBe(true);
    expect(check.body.stock).toBe(await stockOf(db, product));
    const rows = (await movements(product)).data.sort(
        (a, b) => a.sequence - b.sequence,
    );
    let balance = 0;
    for (const row of rows) {
        balance += row.quantity;
        expect(row.balanceAfter).toBe(balance);
    }
    expect(balance).toBe(check.body.stock);
}
function receive(product: string, qty: number) {
    return db.call(restocker, 'POST', '/restocks', {
        supplier,
        description: 'Ledger receipt',
        restockDetails: [{ product, quantity: qty, unitCost: 100 }],
    });
}
it('records each source once, nets repeated lines, replays sales and records void/refund separately', async () => {
    const product = await seedProduct(db, 100, 5);
    expect(
        (
            await db.call(restocker, 'POST', '/restocks', {
                supplier,
                description: 'Duplicate lines',
                restockDetails: [
                    { product, quantity: 3, unitCost: 100 },
                    { product, quantity: 2, unitCost: 100 },
                ],
            })
        ).status,
    ).toBe(201);
    let rows = (await movements(product)).data;
    expect(rows.map((r) => [r.type, r.quantity, r.balanceAfter])).toEqual([
        [StockMovementType.RESTOCK, 5, 10],
        [StockMovementType.OPENING, 5, 5],
    ]);
    expect(rows[1].user).toBeNull();
    const body = cashSale(product, 2, 200);
    const sale = await read<{ _id: string }>(
        await db.call(seller, 'POST', '/sales', body),
    );
    expect(sale.status).toBe(201);
    expect((await db.call(seller, 'POST', '/sales', body)).status).toBe(201);
    const context = {
        reversal: { saleId: sale.body._id, reason: 'Ledger reversal' },
    };
    const headers = await approvalHeaders(
        db,
        seller,
        OverrideAction.VOID,
        context,
    );
    expect(
        (
            await db.call(
                seller,
                'POST',
                `/sales/${sale.body._id}/void`,
                { reason: 'Ledger reversal' },
                headers,
            )
        ).status,
    ).toBe(201);
    const second = await read<{ _id: string }>(
        await db.call(seller, 'POST', '/sales', cashSale(product, 1, 100)),
    );
    const refund = await approvalHeaders(db, seller, OverrideAction.REFUND, {
        reversal: { saleId: second.body._id, reason: 'Ledger refund' },
    });
    expect(
        (
            await db.call(
                seller,
                'POST',
                `/sales/${second.body._id}/refund`,
                { reason: 'Ledger refund' },
                refund,
            )
        ).status,
    ).toBe(201);
    expect(
        (
            await db.call(adjuster, 'POST', '/adjustments', {
                description: 'Ledger correction',
                adjustDetails: [
                    { product, change: 4, reason: 'Counted extras' },
                    { product, change: -1, reason: 'Damaged' },
                ],
            })
        ).status,
    ).toBe(201);
    rows = (await movements(product)).data;
    expect(rows.filter((r) => r.type === StockMovementType.SALE)).toHaveLength(
        2,
    );
    expect(
        rows.some((r) => r.type === StockMovementType.VOID && r.quantity === 2),
    ).toBe(true);
    expect(
        rows.some(
            (r) => r.type === StockMovementType.REFUND && r.quantity === 1,
        ),
    ).toBe(true);
    expect(
        rows
            .filter((r) => r.type === StockMovementType.ADJUSTMENT)
            .map((r) => r.quantity),
    ).toEqual([3]);
    await assertMatches(product);
});
it('serializes concurrent first writes and ledger sequences on a fresh product', async () => {
    const product = await seedProduct(db, 100, 0);
    const results = await Promise.all([
        receive(product, 3),
        receive(product, 4),
        receive(product, 5),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    const rows = (await movements(product)).data;
    expect(
        rows.filter((r) => r.type === StockMovementType.OPENING),
    ).toHaveLength(1);
    expect(new Set(rows.map((r) => r.sequence)).size).toBe(4);
    await assertMatches(product);
});
it('rolls back stock and ledger for rejected adjustments and late-failing multi-product sales', async () => {
    const first = await seedProduct(db, 100, 4),
        empty = await seedProduct(db, 100, 0);
    expect((await receive(first, 1)).status).toBe(201);
    const before = await movements(first);
    expect(
        (
            await db.call(adjuster, 'POST', '/adjustments', {
                description: 'Must rollback',
                adjustDetails: [
                    { product: first, change: 1, reason: 'First' },
                    { product: empty, change: -1, reason: 'Invalid' },
                ],
            })
        ).status,
    ).toBe(400);
    expect(await movements(first)).toEqual(before);
    expect(await stockOf(db, first)).toBe(5);
    expect(
        (
            await db.call(seller, 'POST', '/sales', {
                ...cashSale(first, 1, 200),
                sellDetails: [
                    { product: first, quantity: 1 },
                    { product: empty, quantity: 1 },
                ],
            })
        ).status,
    ).toBe(400);
    expect(await movements(first)).toEqual(before);
    await assertMatches(first);
});
it('posts approved physical counts as COUNT and never double records their adjustment', async () => {
    const product = await seedProduct(db, 100, 10);
    const created = await read<{
        _id: string;
        version: number;
        lines: { _id: string }[];
    }>(
        await db.call(adjuster, 'POST', '/stock-counts', {
            scope: 'products',
            products: [product],
        }),
    );
    expect(created.status).toBe(201);
    const saved = await read<{ version: number }>(
        await db.call(adjuster, 'PATCH', `/stock-counts/${created.body._id}`, {
            version: created.body.version,
            lines: [{ line: created.body.lines[0]._id, countedQty: 8 }],
        }),
    );
    const submitted = await read<{ version: number }>(
        await db.call(
            adjuster,
            'POST',
            `/stock-counts/${created.body._id}/submit`,
            { version: saved.body.version },
        ),
    );
    const headers = await approvalHeaders(
        db,
        adjuster,
        OverrideAction.STOCK_COUNT,
        {
            stockCount: {
                countId: created.body._id,
                version: submitted.body.version,
            },
        },
    );
    expect(
        (
            await db.call(
                adjuster,
                'POST',
                `/stock-counts/${created.body._id}/approve`,
                { version: submitted.body.version },
                headers,
            )
        ).status,
    ).toBe(201);
    const rows = (await movements(product)).data;
    expect(rows.filter((r) => r.type === StockMovementType.COUNT)).toHaveLength(
        1,
    );
    expect(rows.some((r) => r.type === StockMovementType.ADJUSTMENT)).toBe(
        false,
    );
    expect(rows[0].refId).toBe(created.body._id);
    await assertMatches(product);
});
it('limits access, pages posted dates, keeps archived history and reports raw corruption without repairing it', async () => {
    const product = await seedProduct(db, 100, 2);
    expect((await receive(product, 1)).status).toBe(201);
    expect(
        (
            await db.call(
                seller,
                'GET',
                `/products/${product}/movements?page=1&limit=20`,
            )
        ).status,
    ).toBe(403);
    expect(
        (
            await db.call(
                admin,
                'GET',
                `/products/${product}/movements?page=1&limit=101`,
            )
        ).status,
    ).toBe(400);
    expect(
        (
            await db.call(
                admin,
                'GET',
                `/products/${product}/movements?from=2026-11-02&to=2026-11-01`,
            )
        ).status,
    ).toBe(400);
    expect(
        (await movements(product, adjuster, '&from=1900-01-01&to=1900-01-01'))
            .data,
    ).toEqual([]);
    expect(
        (
            await db.call(restocker, 'PATCH', '/products', {
                updates: [{ product, update: { isActive: false } }],
            })
        ).status,
    ).toBe(200);
    expect((await movements(product)).totalItems).toBe(2);
    await db.model('Inventory').updateOne({ product }, { $inc: { stock: 1 } });
    const check = await read<StockIntegrityView>(
        await db.call(admin, 'GET', `/products/${product}/movements/integrity`),
    );
    expect(check.body).toMatchObject({ matches: false, difference: 1 });
    expect((await receive(product, 1)).status).toBe(500);
    expect(await stockOf(db, product)).toBe(4);
});
it('fails startup rather than serving requests before unique ledger indexes exist', async () => {
    const indexes = await db.model('StockMovement').collection.indexes();
    expect(
        indexes.some(
            (index) =>
                index.unique === true &&
                index.key.product === 1 &&
                index.key.sequence === 1,
        ),
    ).toBe(true);
    expect(
        (
            await db.call(
                admin,
                'GET',
                `/products/${new Types.ObjectId().toString()}/movements`,
            )
        ).status,
    ).toBe(404);
    expect(
        (await db.call(admin, 'GET', `/products/${randomUUID()}/movements`))
            .status,
    ).toBe(400);
});

it('batches mixed first-use/existing measured products and repeated lines without changing sequences', async () => {
    const existing = await seedProduct(db, 100, 1000);
    const firstUse = await seedProduct(db, 100, 2000);
    await db
        .model('Product')
        .collection.updateOne(
            { _id: new Types.ObjectId(existing) },
            { $set: { unit: UnitOfMeasure.KG } },
        );
    await db
        .model('Product')
        .collection.updateOne(
            { _id: new Types.ObjectId(firstUse) },
            { $set: { unit: UnitOfMeasure.L } },
        );
    expect((await receive(existing, 500)).status).toBe(201);
    const model = db.model<StockMovement>('StockMovement');
    const insert = jest.spyOn(model, 'insertMany');
    try {
        const result = await db.call(restocker, 'POST', '/restocks', {
            supplier,
            description: 'Mixed ledger batch',
            restockDetails: [
                { product: firstUse, quantity: 250, unitCost: 100 },
                { product: existing, quantity: 125, unitCost: 100 },
                { product: firstUse, quantity: 500, unitCost: 100 },
            ],
        });
        expect(result.status).toBe(201);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(insert.mock.calls[0]?.[0]).toHaveLength(3);
    } finally {
        insert.mockRestore();
    }
    expect(
        (await movements(existing)).data.map(
            ({ sequence, quantity, unit, balanceAfter }) => ({
                sequence,
                quantity,
                unit,
                balanceAfter,
            }),
        ),
    ).toEqual([
        { sequence: 2, quantity: 125, unit: 'KG', balanceAfter: 1625 },
        { sequence: 1, quantity: 500, unit: 'KG', balanceAfter: 1500 },
        { sequence: 0, quantity: 1000, unit: 'KG', balanceAfter: 1000 },
    ]);
    expect(
        (await movements(firstUse)).data.map(
            ({ sequence, quantity, unit, balanceAfter }) => ({
                sequence,
                quantity,
                unit,
                balanceAfter,
            }),
        ),
    ).toEqual([
        { sequence: 1, quantity: 750, unit: 'L', balanceAfter: 2750 },
        { sequence: 0, quantity: 2000, unit: 'L', balanceAfter: 2000 },
    ]);
    await assertMatches(existing);
    await assertMatches(firstUse);
});

it('rolls back an actually inserted ledger batch, opening rows, receipt and costs after a late failure', async () => {
    const existing = await seedProduct(db, 100, 5);
    const firstUse = await seedProduct(db, 100, 2);
    expect((await receive(existing, 1)).status).toBe(201);
    const before = await movements(existing);
    const model = db.model<StockMovement>('StockMovement');
    const insert = model.insertMany.bind(model) as (
        rows: StockMovement[],
        options: InsertManyOptions,
    ) => Promise<unknown>;
    const spy = jest
        .spyOn(model, 'insertMany')
        .mockImplementationOnce(
            async (rows: unknown, options: InsertManyOptions = {}) => {
                await insert(rows as StockMovement[], options);
                throw new Error('Failed after ledger batch insertion');
            },
        );
    const receipts = await db.model('Restock').countDocuments();
    const productBefore = await db.model('Product').findById(existing).lean();
    try {
        const result = await db.call(restocker, 'POST', '/restocks', {
            supplier,
            description: 'Whole batch must roll back',
            restockDetails: [
                { product: existing, quantity: 3, unitCost: 999 },
                { product: firstUse, quantity: 4, unitCost: 999 },
            ],
        });
        expect(result.status).toBe(500);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]?.[0]).toHaveLength(3);
    } finally {
        spy.mockRestore();
    }
    expect(await movements(existing)).toEqual(before);
    expect((await movements(firstUse)).data).toEqual([]);
    expect(await stockOf(db, existing)).toBe(6);
    expect(await stockOf(db, firstUse)).toBe(2);
    expect(await db.model('Restock').countDocuments()).toBe(receipts);
    expect(await db.model('Product').findById(existing).lean()).toEqual(
        productBefore,
    );
});
