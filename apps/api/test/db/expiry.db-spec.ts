import { SettingsService } from '../../src/settings/settings.service';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
    OverrideAction,
    Role,
    UnitOfMeasure,
    type InventoryBatchView,
    type Paginated,
    type Receipt,
    wireShapeDiff,
    INVENTORY_BATCH_SHAPE,
} from '@grocery-pos/contracts';
import { InventoryBatchService } from '../../src/inventory-man/batch/batch.service';
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
} from './db-app';
import { approvalHeaders } from './approval-fixtures';
let db: DbApp, supplier: string;
let storeTimezone: string;
const admin = caller('expiry-admin', Role.Admin),
    restocker = caller('expiry-restocker', Role.Restocker),
    adjuster = caller('expiry-adjuster', Role.Adjuster);
beforeAll(async () => {
    db = await bootDbApp();
    storeTimezone = await db.app.get(SettingsService).timezone();
    supplier = await seedSupplier(db);
});
afterAll(async () => db?.close());
function day(offset: number) {
    const d = new Date(
        `${db.app.get(InventoryBatchService).today(new Date(), storeTimezone)}T00:00:00Z`,
    );
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
}
async function product(unit?: UnitOfMeasure) {
    const id = await seedProduct(db, 18000, 0);
    if (unit)
        await db
            .model('Product')
            .collection.updateOne(
                { _id: new Types.ObjectId(id) },
                { $set: { unit } },
            );
    const result = await db.call(restocker, 'PATCH', '/products', {
        updates: [{ product: id, update: { tracksExpiry: true } }],
    });
    expect(result.status).toBe(200);
    return id;
}
async function receive(
    id: string,
    qty: number,
    expiryDate = day(2),
    batchNo: string = randomUUID(),
) {
    return db.call(restocker, 'POST', '/restocks', {
        supplier,
        description: 'Expiry receipt',
        restockDetails: [
            { product: id, quantity: qty, unitCost: 100, expiryDate, batchNo },
        ],
    });
}
async function batches(id: string) {
    const result = await read<Paginated<InventoryBatchView>>(
        await db.call(
            restocker,
            'GET',
            `/inventories/batches?product=${id}&page=1&limit=100`,
        ),
    );
    expect(result.status).toBe(200);
    return result.body.data;
}
async function invariant(id: string) {
    const rows = await db
        .model<{ remainingQty: number }>('InventoryBatch')
        .find({ product: id })
        .lean();
    expect(rows.reduce((sum, row) => sum + row.remainingQty, 0)).toBe(
        await stockOf(db, id),
    );
}
async function cashier() {
    const seller = caller(`expiry-${randomUUID()}`, Role.Seller);
    await openShift(db, seller);
    return seller;
}
it('requires valid expiry on tracked receipts, rejects unrelated metadata and keeps untracked legacy behavior', async () => {
    const id = await product();
    for (const expiryDate of [undefined, null, '2026-02-30', 'bad']) {
        const result = await db.call(restocker, 'POST', '/restocks', {
            supplier,
            description: 'Invalid',
            restockDetails: [
                {
                    product: id,
                    quantity: 2,
                    unitCost: 10,
                    ...(expiryDate !== undefined && { expiryDate }),
                },
            ],
        });
        expect(result.status).toBe(400);
        expect(await stockOf(db, id)).toBe(0);
    }
    const ordinary = await seedProduct(db, 100, 0);
    expect((await receive(ordinary, 1)).status).toBe(400);
    expect(
        (
            await db.call(restocker, 'POST', '/restocks', {
                supplier,
                description: 'Legacy',
                restockDetails: [
                    { product: ordinary, quantity: 1, unitCost: 0 },
                ],
            })
        ).status,
    ).toBe(201);
});
it('creates exact batches, FEFO consumes unexpired lots, persists allocation, and reversal returns the same lots', async () => {
    const id = await product(UnitOfMeasure.KG);
    expect((await receive(id, 500, day(8), 'later')).status).toBe(201);
    expect((await receive(id, 300, day(1), 'first')).status).toBe(201);
    const seller = await cashier(),
        request = cashSale(id, 450, 8100);
    const response = await read<Receipt>(
        await db.call(seller, 'POST', '/sales', request),
    );
    expect(response.status).toBe(201);
    expect(response.body.totalAmount).toBe(8100);
    let rows = await batches(id);
    expect(rows.map((row) => [row.batchNo, row.remainingQty])).toEqual([
        ['later', 350],
    ]);
    expect(wireShapeDiff(rows[0], INVENTORY_BATCH_SHAPE)).toEqual({
        missing: [],
        unexpected: [],
    });
    await invariant(id);
    const stored = await db
        .model<{ batchAllocations: { batch: string; quantity: number }[] }>(
            'SalesDetails',
        )
        .findOne({ sales: response.body._id })
        .select('+batchAllocations')
        .lean();
    expect(stored?.batchAllocations.map((a) => a.quantity)).toEqual([300, 150]);
    const reason = 'Wrong sale';
    const headers = await approvalHeaders(db, seller, OverrideAction.VOID, {
        reversal: { saleId: response.body._id, reason },
    });
    expect(
        (
            await db.call(
                seller,
                'POST',
                `/sales/${response.body._id}/void`,
                { reason },
                headers,
            )
        ).status,
    ).toBe(201);
    rows = await batches(id);
    expect(rows.map((row) => [row.batchNo, row.remainingQty])).toEqual([
        ['first', 300],
        ['later', 500],
    ]);
    await invariant(id);
});
it('blocks expired online sales, treats today as usable, writes off a chosen batch transactionally', async () => {
    const id = await product();
    expect((await receive(id, 2, day(-1), 'expired')).status).toBe(201);
    expect((await receive(id, 1, day(0), 'today')).status).toBe(201);
    const seller = await cashier();
    expect(
        (await db.call(seller, 'POST', '/sales', cashSale(id, 2, 36000)))
            .status,
    ).toBe(400);
    expect(await stockOf(db, id)).toBe(3);
    expect(
        (await db.call(seller, 'POST', '/sales', cashSale(id, 1, 18000)))
            .status,
    ).toBe(201);
    const expired = (await batches(id))[0];
    expect(expired.batchNo).toBe('expired');
    expect(
        (
            await db.call(adjuster, 'POST', '/adjustments', {
                description: 'Expired lot',
                adjustDetails: [
                    {
                        product: id,
                        batch: expired._id,
                        change: -2,
                        reason: 'Expired',
                    },
                ],
            })
        ).status,
    ).toBe(201);
    expect(await stockOf(db, id)).toBe(0);
    await invariant(id);
});
it('rejects wrong-batch and aggregate adjustments without partial writes; supports positive batch corrections', async () => {
    const id = await product();
    await receive(id, 2);
    const batch = (await batches(id))[0];
    for (const line of [
        { product: id, change: -1, reason: 'missing batch' },
        {
            product: id,
            batch: new Types.ObjectId().toString(),
            change: -1,
            reason: 'wrong batch',
        },
        { product: id, batch: batch._id, change: -3, reason: 'too many' },
    ]) {
        expect(
            (
                await db.call(adjuster, 'POST', '/adjustments', {
                    description: 'Rejected',
                    adjustDetails: [line],
                })
            ).status,
        ).toBe(400);
        expect(await stockOf(db, id)).toBe(2);
        await invariant(id);
    }
    expect(
        (
            await db.call(adjuster, 'POST', '/adjustments', {
                description: 'Count correction',
                adjustDetails: [
                    {
                        product: id,
                        batch: batch._id,
                        change: 2,
                        reason: 'Found',
                    },
                ],
            })
        ).status,
    ).toBe(201);
    await invariant(id);
    expect(await stockOf(db, id)).toBe(4);
});
it('serializes concurrent FEFO sales and tracking changes, never oversells or loses quantity', async () => {
    const id = await product();
    await receive(id, 1);
    const seller = await cashier();
    const results = await Promise.all(
        [1, 2].map(() =>
            db.call(seller, 'POST', '/sales', cashSale(id, 1, 18000)),
        ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    await invariant(id);
    expect(await stockOf(db, id)).toBe(0);
    const stocked = await seedProduct(db, 100, 1);
    expect(
        (
            await db.call(restocker, 'PATCH', '/products', {
                updates: [{ product: stocked, update: { tracksExpiry: true } }],
            })
        ).status,
    ).toBe(400);
    expect(
        (
            await db.call(restocker, 'PATCH', '/products', {
                updates: [{ product: stocked, update: { tracksExpiry: null } }],
            })
        ).status,
    ).toBe(400);
});
it('lists expiring batches with bounded filters and protects management endpoints', async () => {
    const id = await product();
    await receive(id, 2, day(-1));
    await receive(id, 3, day(8));
    const listed = await read<Paginated<InventoryBatchView>>(
        await db.call(
            restocker,
            'GET',
            `/inventories/expiring?product=${id}&days=7&page=1&limit=100`,
        ),
    );
    expect(listed.status).toBe(200);
    expect(listed.body.totalItems).toBe(1);
    expect(listed.body.data[0]?.daysLeft).toBe(-1);
    expect(
        (
            await db.call(
                caller('seller', Role.Seller),
                'GET',
                '/inventories/expiring',
            )
        ).status,
    ).toBe(403);
    for (const query of ['days=-1', 'days=366', 'limit=101', 'page=0'])
        expect(
            (await db.call(restocker, 'GET', `/inventories/expiring?${query}`))
                .status,
        ).toBe(400);
});
it('serializes tracking enablement against an ordinary stock correction', async () => {
    const id = await seedProduct(db, 100, 0);
    const responses = await Promise.all([
        db.call(restocker, 'PATCH', '/products', {
            updates: [{ product: id, update: { tracksExpiry: true } }],
        }),
        db.call(adjuster, 'POST', '/adjustments', {
            description: 'Count',
            adjustDetails: [{ product: id, change: 1, reason: 'Found' }],
        }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual(
        expect.arrayContaining([400]),
    );
    const row = await db
        .model<{ tracksExpiry?: boolean }>('Product')
        .findById(id)
        .lean();
    if (row?.tracksExpiry) {
        expect(await stockOf(db, id)).toBe(0);
        await invariant(id);
    } else expect(await stockOf(db, id)).toBe(1);
});
it('keeps all receipt lines and stock atomic when a later tracked line lacks expiry', async () => {
    const id = await product();
    const response = await db.call(restocker, 'POST', '/restocks', {
        supplier,
        description: 'Rollback',
        restockDetails: [
            { product: id, quantity: 2, unitCost: 1, expiryDate: day(2) },
            { product: id, quantity: 2, unitCost: 1 },
        ],
    });
    expect(response.status).toBe(400);
    expect(await stockOf(db, id)).toBe(0);
    await invariant(id);
    expect(
        await db.model('Restock').countDocuments({ description: 'Rollback' }),
    ).toBe(0);
    expect(
        await db.model('InventoryBatch').countDocuments({ product: id }),
    ).toBe(0);
    const valid = await db.call(restocker, 'POST', '/restocks', {
        supplier,
        description: 'Two lots',
        restockDetails: [
            { product: id, quantity: 2, unitCost: 1, expiryDate: day(2) },
            { product: id, quantity: 3, unitCost: 1, expiryDate: day(3) },
        ],
    });
    expect(valid.status).toBe(201);
    expect(await stockOf(db, id)).toBe(5);
    await invariant(id);
});
it('returns expired allocations to the original lot without making them sellable', async () => {
    const id = await product();
    await receive(id, 2, day(1));
    const seller = await cashier(),
        request = cashSale(id, 1, 18000);
    const sold = await read<Receipt>(
        await db.call(seller, 'POST', '/sales', request),
    );
    expect(sold.status).toBe(201);
    await db
        .model('InventoryBatch')
        .updateMany({ product: id }, { $set: { expiryDate: day(-1) } });
    const reason = 'Customer return';
    const headers = await approvalHeaders(db, seller, OverrideAction.REFUND, {
        reversal: { saleId: sold.body._id, reason },
    });
    expect(
        (
            await db.call(
                seller,
                'POST',
                `/sales/${sold.body._id}/refund`,
                { reason },
                headers,
            )
        ).status,
    ).toBe(201);
    expect(await stockOf(db, id)).toBe(2);
    await invariant(id);
    expect(
        (await db.call(seller, 'POST', '/sales', cashSale(id, 1, 18000)))
            .status,
    ).toBe(400);
});
it('withholds new offline proofs and admin-recovers collected legacy cash into explicit deficit batches', async () => {
    const id = await seedProduct(db, 1000, 0),
        seller = await cashier();
    await db.model('User').updateOne(
        { _id: seller.userId },
        {
            $set: {
                name: seller.username,
                roles: seller.roles,
                isActive: true,
                passwordHash: 'test',
            },
        },
        { upsert: true },
    );
    await db.model('User').updateOne(
        { _id: admin.userId },
        {
            $set: {
                name: admin.username,
                roles: admin.roles,
                isActive: true,
                passwordHash: 'test',
            },
        },
        { upsert: true },
    );
    await db.model('RefreshToken').create({
        user: seller.userId,
        family: seller.userId,
        expiry: new Date(Date.now() + 3600000),
    });
    const leaseResponse = await read<{
        _id: string;
        shift: { _id: string };
        expiresAt: string;
    }>(
        await db.call(seller, 'POST', '/offline/lease', {
            terminalId: randomUUID(),
        }),
    );
    expect(leaseResponse.status).toBe(201);
    const storedProduct = await db
        .model<{ EAN: string }>('Product')
        .findById(id)
        .lean();
    // This is an authentic legacy proof issued while the item was not expiry tracked.
    const proof = db.app.get(JwtService).sign(
        {
            purpose: 'offline-price-v1',
            lease: leaseResponse.body._id,
            cashier: seller.userId,
            shift: leaseResponse.body.shift._id,
            product: id,
            EAN: storedProduct!.EAN,
            price: 1000,
            unit: UnitOfMeasure.PIECE,
        },
        {
            secret: process.env.JWT_SECRET!,
            audience: 'grocery-pos-offline-price-v1',
            expiresIn: 600,
        },
    );
    const body = {
        lease: leaseResponse.body._id,
        idempotencyKey: randomUUID(),
        soldAt: new Date().toISOString(),
        amountTendered: 1000,
        lines: [{ product: id, quantity: 1, proof }],
    };
    expect(
        (
            await db.call(restocker, 'PATCH', '/products', {
                updates: [{ product: id, update: { tracksExpiry: true } }],
            })
        ).status,
    ).toBe(200);
    const catalog = await read<{
        products: { _id: string; proof: string; isActive?: boolean }[];
    }>(
        await db.call(
            seller,
            'GET',
            `/offline/catalog?lease=${leaseResponse.body._id}&limit=100`,
        ),
    );
    expect(catalog.status).toBe(200);
    // Tombstones are paginated; this product was created last and may be on a later page.
    const tombstone = catalog.body.products.find((p) => p._id === id);
    expect(tombstone).toMatchObject({ proof: '', isActive: false });
    expect((await db.call(seller, 'POST', '/offline/sync', body)).status).toBe(
        409,
    );
    const reconciled = await read<Receipt>(
        await db.call(admin, 'POST', '/offline/reconcile', {
            ...body,
            reason: 'Collected before expiry tracking',
        }),
    );
    expect(reconciled.status).toBe(201);
    expect(await stockOf(db, id)).toBe(-1);
    await invariant(id);
    const deficit = (await batches(id))[0];
    expect(deficit).toMatchObject({
        reconciliation: true,
        receivedQty: 0,
        remainingQty: -1,
    });
    expect(deficit.expiryDate).toBeUndefined();
    expect(
        (
            await db.call(admin, 'POST', '/offline/reconcile', {
                ...body,
                reason: 'Retry',
            })
        ).status,
    ).toBe(201);
    expect(await stockOf(db, id)).toBe(-1);
    expect(
        (
            await db.call(adjuster, 'POST', '/adjustments', {
                description: 'Reconcile count',
                adjustDetails: [
                    {
                        product: id,
                        batch: deficit._id,
                        change: 1,
                        reason: 'Resolved deficit',
                    },
                ],
            })
        ).status,
    ).toBe(201);
    expect(await stockOf(db, id)).toBe(0);
    await invariant(id);
});
it('prevents disabling after sell-to-zero so a later expired return cannot bypass expiry', async () => {
    const id = await product();
    await receive(id, 1, day(1));
    const seller = await cashier();
    const sold = await read<Receipt>(
        await db.call(seller, 'POST', '/sales', cashSale(id, 1, 18000)),
    );
    expect(sold.status).toBe(201);
    expect(await stockOf(db, id)).toBe(0);
    const disabled = await read<{ message: string }>(
        await db.call(restocker, 'PATCH', '/products', {
            updates: [{ product: id, update: { tracksExpiry: false } }],
        }),
    );
    expect(disabled.status).toBe(400);
    expect(disabled.body.message).toContain('batch history');
    await db
        .model('InventoryBatch')
        .updateMany({ product: id }, { $set: { expiryDate: day(-1) } });
    const reason = 'Expired return';
    const headers = await approvalHeaders(db, seller, OverrideAction.REFUND, {
        reversal: { saleId: sold.body._id, reason },
    });
    expect(
        (
            await db.call(
                seller,
                'POST',
                `/sales/${sold.body._id}/refund`,
                { reason },
                headers,
            )
        ).status,
    ).toBe(201);
    expect(await stockOf(db, id)).toBe(1);
    await invariant(id);
    expect(
        (await db.call(seller, 'POST', '/sales', cashSale(id, 1, 18000)))
            .status,
    ).toBe(400);
});
it('keeps the dashboard expiring count equal to the Expiring list, archived products and the configured window included (#213)', async () => {
    async function settingsVersion() {
        return (
            await read<{ version: number }>(
                await db.call(admin, 'GET', '/settings'),
            )
        ).body.version;
    }
    async function setWindow(days: number) {
        const result = await db.call(admin, 'PATCH', '/settings', {
            version: await settingsVersion(),
            expiryAlertDays: days,
        });
        expect(result.status).toBe(200);
    }
    async function figures() {
        const dashboard = await read<{
            expiringBatchCount: number;
            expiryAlertDays: number;
        }>(await db.call(admin, 'GET', '/dashboard'));
        const list = await read<Paginated<InventoryBatchView>>(
            await db.call(
                restocker,
                'GET',
                '/inventories/expiring?page=1&limit=100',
            ),
        );
        expect(dashboard.status).toBe(200);
        expect(list.status).toBe(200);
        expect(dashboard.body.expiringBatchCount).toBe(list.body.totalItems);
        return {
            count: list.body.totalItems,
            days: dashboard.body.expiryAlertDays,
        };
    }
    const kept = await product();
    const archived = await product();
    expect((await receive(kept, 2, day(1))).status).toBe(201);
    expect((await receive(archived, 2, day(1))).status).toBe(201);
    expect((await receive(kept, 2, day(20))).status).toBe(201);
    const base = await figures();
    expect(base.days).toBe(7);
    await db
        .model('Product')
        .collection.updateOne(
            { _id: new Types.ObjectId(archived) },
            { $set: { isActive: false } },
        );
    expect((await figures()).count).toBe(base.count - 1);
    await setWindow(30);
    try {
        expect((await figures()).days).toBe(30);
        const own = await read<Paginated<InventoryBatchView>>(
            await db.call(
                restocker,
                'GET',
                `/inventories/expiring?product=${kept}&page=1&limit=100`,
            ),
        );
        expect(own.body.totalItems).toBe(2);
        const gone = await read<Paginated<InventoryBatchView>>(
            await db.call(
                restocker,
                'GET',
                `/inventories/expiring?product=${archived}&page=1&limit=100`,
            ),
        );
        expect(gone.body.totalItems).toBe(0);
    } finally {
        await setWindow(7);
    }
});
