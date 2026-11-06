import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
    PurchaseOrderStatus,
    ErrorCode,
    Role,
    StockMovementType,
    UnitOfMeasure,
    type Paginated,
    type ProductCostView,
    type PurchaseOrderView,
    type StockMovementView,
} from '@grocery-pos/contracts';
import {
    bootDbApp,
    caller,
    read,
    seedProduct,
    seedSupplier,
    stockOf,
    type DbApp,
} from './db-app';

let db: DbApp;
const admin = caller('po-admin', Role.Admin),
    restocker = caller('po-restocker', Role.Restocker);

beforeAll(async () => {
    db = await bootDbApp();
    await db.model('User').create({
        _id: new Types.ObjectId(restocker.userId),
        name: restocker.username,
        roles: restocker.roles,
        isActive: true,
        passwordHash: 'test',
    });
});
afterAll(async () => {
    await db?.close();
});

async function call(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
) {
    return read<PurchaseOrderView>(
        await db.call(restocker, method, path, body),
    );
}
async function sentOrder(
    lines: { product: string; orderedQty: number; expectedCost: number }[],
    supplier?: string,
) {
    const created = await call('POST', '/purchase-orders', {
        supplier: supplier ?? (await seedSupplier(db)),
        lines,
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe(PurchaseOrderStatus.DRAFT);
    const sent = await call(
        'POST',
        `/purchase-orders/${created.body._id}/send`,
        {
            version: created.body.version,
        },
    );
    expect(sent.status).toBe(201);
    return sent.body;
}
function receive(
    po: PurchaseOrderView,
    lines: { quantity: number; unitCost: number; expiryDate?: string }[],
    key = `k-${randomUUID()}`,
) {
    return call('POST', `/purchase-orders/${po._id}/receive`, {
        version: po.version,
        idempotencyKey: key,
        lines: lines.map((l, i) => ({ line: po.lines[i]._id, ...l })),
    });
}
const restockCount = (po: string) =>
    db
        .model('Restock')
        .countDocuments({ purchaseOrder: new Types.ObjectId(po) });

it('moves no stock before receipt and locks lines once sent', async () => {
    const product = await seedProduct(db, 1000, 2);
    const po = await sentOrder([{ product, orderedQty: 5, expectedCost: 600 }]);
    expect(await stockOf(db, product)).toBe(2);
    const edit = await call('PATCH', `/purchase-orders/${po._id}`, {
        version: po.version,
        supplier: po.supplier!._id,
        lines: [{ product, orderedQty: 9, expectedCost: 600 }],
    });
    expect(edit.status).toBe(409);
});

it('receives partially then fully, writing restock, ledger and lastCost', async () => {
    const product = await seedProduct(db, 1000, 0);
    let po = await sentOrder([{ product, orderedQty: 5, expectedCost: 600 }]);
    const first = await receive(po, [{ quantity: 2, unitCost: 650 }]);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
    expect(first.body.lines[0]).toMatchObject({
        receivedQty: 2,
        outstandingQty: 3,
    });
    po = first.body;
    const second = await receive(po, [{ quantity: 3, unitCost: 640 }]);
    expect(second.body.status).toBe(PurchaseOrderStatus.RECEIVED);
    expect(second.body.receipts).toHaveLength(2);
    expect(await stockOf(db, product)).toBe(5);
    const costs = await read<ProductCostView[]>(
        await db.call(admin, 'GET', `/suppliers/costs?products=${product}`),
    );
    expect(costs.body[0].lastCost).toBe(640);
    const ledger = await read<Paginated<StockMovementView>>(
        await db.call(
            admin,
            'GET',
            `/products/${product}/movements?page=1&limit=100`,
        ),
    );
    expect(
        ledger.body.data
            .filter((m) => m.type === StockMovementType.RESTOCK)
            .map((m) => m.quantity)
            .sort(),
    ).toEqual([2, 3]);
    const closed = await receive(second.body, [{ quantity: 1, unitCost: 1 }]);
    expect(closed.status).toBe(409);
});

it('refuses over-receipt without writing anything', async () => {
    const product = await seedProduct(db, 1000, 0);
    const po = await sentOrder([{ product, orderedQty: 3, expectedCost: 100 }]);
    const over = await receive(po, [{ quantity: 4, unitCost: 100 }]);
    expect(over.status).toBe(400);
    expect(await stockOf(db, product)).toBe(0);
    expect(await restockCount(po._id)).toBe(0);
});

it('replays a retried receive key once', async () => {
    const product = await seedProduct(db, 1000, 0);
    const po = await sentOrder([{ product, orderedQty: 3, expectedCost: 100 }]);
    const key = `k-${randomUUID()}`;
    const a = await receive(po, [{ quantity: 2, unitCost: 100 }], key);
    const b = await receive(po, [{ quantity: 2, unitCost: 100 }], key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.receipts).toEqual(a.body.receipts);
    expect(await stockOf(db, product)).toBe(2);
    expect(await restockCount(po._id)).toBe(1);
});

it('lets only one of two concurrent receives through', async () => {
    const product = await seedProduct(db, 1000, 0);
    const po = await sentOrder([{ product, orderedQty: 4, expectedCost: 100 }]);
    const results = await Promise.all([
        receive(po, [{ quantity: 4, unitCost: 100 }]),
        receive(po, [{ quantity: 4, unitCost: 100 }]),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await stockOf(db, product)).toBe(4);
    expect(await restockCount(po._id)).toBe(1);
});

it('rolls back a refused expiry-tracked receipt entirely', async () => {
    const product = await seedProduct(db, 18000, 0);
    await db
        .model('Product')
        .collection.updateOne(
            { _id: new Types.ObjectId(product) },
            { $set: { tracksExpiry: true, unit: UnitOfMeasure.KG } },
        );
    const po = await sentOrder([
        { product, orderedQty: 1500, expectedCost: 18000 },
    ]);
    const missing = await receive(po, [{ quantity: 450, unitCost: 18000 }]);
    expect(missing.status).toBe(400);
    const again = await call('GET', `/purchase-orders/${po._id}`);
    expect(again.body.version).toBe(po.version);
    expect(again.body.lines[0].receivedQty).toBe(0);
    expect(await restockCount(po._id)).toBe(0);
    const ok = await receive(po, [
        { quantity: 450, unitCost: 18000, expiryDate: '2099-01-31' },
    ]);
    expect(ok.status).toBe(201);
    expect(await stockOf(db, product)).toBe(450);
    const restock = await db
        .model<{ totalCost: number }>('Restock')
        .findOne({ purchaseOrder: new Types.ObjectId(po._id) })
        .lean();
    expect(restock!.totalCost).toBe(8100);
    expect(
        await db
            .model('InventoryBatch')
            .countDocuments({ product: new Types.ObjectId(product) }),
    ).toBe(1);
});

it('keeps an archived supplier open order receivable and cancellable, refusing new ones', async () => {
    const product = await seedProduct(db, 1000, 0);
    const supplier = await seedSupplier(db);
    const po = await sentOrder(
        [{ product, orderedQty: 3, expectedCost: 100 }],
        supplier,
    );
    const archive = await db.call(admin, 'PATCH', `/suppliers/${supplier}`, {
        isActive: false,
    });
    expect(archive.status).toBe(200);
    const fresh = await call('POST', '/purchase-orders', {
        supplier,
        lines: [{ product, orderedQty: 1, expectedCost: 1 }],
    });
    expect(fresh.status).toBe(400);
    const partial = await receive(po, [{ quantity: 1, unitCost: 100 }]);
    expect(partial.status).toBe(201);
    const cancelled = await call('POST', `/purchase-orders/${po._id}/cancel`, {
        version: partial.body.version,
    });
    expect(cancelled.body).toMatchObject({
        status: PurchaseOrderStatus.CANCELLED,
        closedShort: true,
    });
    expect(cancelled.body.lines[0].outstandingQty).toBe(0);
    expect(await stockOf(db, product)).toBe(1);
    const remove = await db.call(admin, 'DELETE', `/suppliers/${supplier}`);
    expect(remove.status).toBe(400);
});

it('cancels an unwanted draft and keeps it in history', async () => {
    const product = await seedProduct(db, 1000, 0);
    const created = await call('POST', '/purchase-orders', {
        supplier: await seedSupplier(db),
        lines: [{ product, orderedQty: 1, expectedCost: 1 }],
    });
    const cancelled = await call(
        'POST',
        `/purchase-orders/${created.body._id}/cancel`,
        { version: created.body.version },
    );
    expect(cancelled.body).toMatchObject({
        status: PurchaseOrderStatus.CANCELLED,
        closedShort: false,
    });
    const list = await read<Paginated<PurchaseOrderView>>(
        await db.call(
            restocker,
            'GET',
            '/purchase-orders?page=1&limit=100&status=CANCELLED',
        ),
    );
    expect(list.body.data.map((r) => r._id)).toContain(created.body._id);
});

it('refuses a reused key with a different body and changes nothing', async () => {
    const product = await seedProduct(db, 1000, 0);
    const po = await sentOrder([{ product, orderedQty: 3, expectedCost: 100 }]);
    const key = `k-${randomUUID()}`;
    expect(
        (await receive(po, [{ quantity: 1, unitCost: 100 }], key)).status,
    ).toBe(201);
    const other = await receive(po, [{ quantity: 2, unitCost: 100 }], key);
    expect(other.status).toBe(409);
    expect((other.body as unknown as { error: string }).error).toBe(
        ErrorCode.SALE_IDEMPOTENCY_MISMATCH,
    );
    expect(await stockOf(db, product)).toBe(1);
    expect(await restockCount(po._id)).toBe(1);
});

it('ends concurrent retries of one key as one restock, both answered', async () => {
    const product = await seedProduct(db, 1000, 0);
    const po = await sentOrder([{ product, orderedQty: 4, expectedCost: 100 }]);
    const key = `k-${randomUUID()}`;
    const results = await Promise.all([
        receive(po, [{ quantity: 2, unitCost: 100 }], key),
        receive(po, [{ quantity: 2, unitCost: 100 }], key),
        receive(po, [{ quantity: 2, unitCost: 100 }], key),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(await stockOf(db, product)).toBe(2);
    expect(await restockCount(po._id)).toBe(1);
    expect(new Set(results.map((r) => r.body.receipts.join()))).toEqual(
        new Set([results[0].body.receipts.join()]),
    );
});

it('flags archived products on a draft and still refuses to send it', async () => {
    const product = await seedProduct(db, 1000, 0);
    const created = await call('POST', '/purchase-orders', {
        supplier: await seedSupplier(db),
        lines: [{ product, orderedQty: 1, expectedCost: 1 }],
    });
    await db
        .model('Product')
        .collection.updateOne(
            { _id: new Types.ObjectId(product) },
            { $set: { isActive: false } },
        );
    const draft = await call('GET', `/purchase-orders/${created.body._id}`);
    expect(draft.body.lines[0].productActive).toBe(false);
    const send = await call(
        'POST',
        `/purchase-orders/${created.body._id}/send`,
        {
            version: draft.body.version,
        },
    );
    expect(send.status).toBe(404);
});
