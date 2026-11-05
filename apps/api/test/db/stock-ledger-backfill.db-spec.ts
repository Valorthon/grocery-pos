import { Types } from 'mongoose';
import { StockMovementType, Role } from '@grocery-pos/contracts';
import {
    migrateStockLedger,
    STOCK_LEDGER_MIGRATION,
} from '../../src/migrations/stock-ledger';
import { bootDbApp, productDocs, type DbApp } from './db-app';
let db: DbApp;
const product = new Types.ObjectId(),
    actor = new Types.ObjectId(),
    restock = new Types.ObjectId(),
    sale = new Types.ObjectId(),
    adjustment = new Types.ObjectId(),
    count = new Types.ObjectId();
const first = new Date('2026-01-01T00:00:00Z'),
    second = new Date('2026-01-02T00:00:00Z'),
    third = new Date('2026-01-03T00:00:00Z');
beforeAll(async () => {
    db = await bootDbApp();
    const raw = db.connection.db!;
    const docs = productDocs(100, 14);
    await raw
        .collection('products')
        .insertOne({ ...docs.product, _id: product });
    await raw
        .collection('inventories')
        .insertOne({ ...docs.inventory, product, stock: 14 });
    await raw.collection('users').insertOne({
        _id: actor,
        name: 'historical-actor',
        roles: [Role.Admin],
    });
    await raw
        .collection('restocks')
        .insertOne({ _id: restock, createdAt: first, restockedBy: actor });
    await raw
        .collection('restockdetails')
        .insertOne({ restock, product, quantity: 10, unitCost: 50 });
    await raw.collection('sales').insertOne({
        _id: sale,
        createdAt: second,
        soldAt: new Date('2025-12-31T00:00:00Z'),
        cashier: actor,
        reversal: { type: 'REFUND', at: third, approvedBy: actor },
    });
    await raw
        .collection('salesdetails')
        .insertOne({ sales: sale, product, quantity: 3, unitPrice: 100 });
    await raw
        .collection('adjustments')
        .insertOne({ _id: adjustment, createdAt: second, adjustedBy: actor });
    await raw
        .collection('adjustmentdetails')
        .insertOne({ adjustment, product, change: -1, reason: 'count' });
    await raw.collection('stockcounts').insertOne({ _id: count, adjustment });
});
afterAll(async () => {
    await db?.close();
});
it('dry-runs known history and explicit opening gap without initializing models or writing markers/rows', async () => {
    const spy = jest.spyOn(db.connection, 'model');
    try {
        const plans = await migrateStockLedger(db.connection, false);
        expect(plans).toEqual([
            {
                product: String(product),
                stock: 14,
                knownNet: 9,
                opening: 5,
                events: 4,
                alreadyApplied: false,
            },
        ]);
        expect(spy).not.toHaveBeenCalled();
        expect(await db.model('StockMovement').countDocuments()).toBe(0);
        expect(
            await db.connection.db!.collection('migrations').countDocuments(),
        ).toBe(0);
    } finally {
        spy.mockRestore();
    }
});
it('atomically reconstructs source facts once and marks derived balances/opening without inventing an actor', async () => {
    await migrateStockLedger(db.connection, true);
    const raw = db.connection.db!;
    const rows = await raw
        .collection<{
            type: string;
            quantity: number;
            balanceAfter: number;
            historical: boolean;
            sequence: number;
            occurredAt: Date;
            createdAt: Date;
            refId?: Types.ObjectId;
            user?: Types.ObjectId;
        }>('stockmovements')
        .find({ product })
        .sort({ sequence: 1 })
        .toArray();
    expect(rows.map((r) => [r.type, r.quantity, r.balanceAfter])).toEqual([
        ['OPENING', 5, 5],
        ['RESTOCK', 10, 15],
        ['COUNT', -1, 14],
        ['SALE', -3, 11],
        ['REFUND', 3, 14],
    ]);
    expect(rows.every((r) => r.historical === true)).toBe(true);
    expect(rows[0].user).toBeUndefined();
    expect(rows[2].refId).toEqual(count);
    expect(rows[3].occurredAt).toEqual(new Date('2025-12-31T00:00:00Z'));
    expect(rows[3].createdAt).toEqual(second);
    const ids = rows.map((r) => String(r._id));
    expect(
        (await migrateStockLedger(db.connection, true))[0].alreadyApplied,
    ).toBe(true);
    expect(
        (
            await raw
                .collection('stockmovements')
                .find({ product })
                .sort({ sequence: 1 })
                .toArray()
        ).map((r) => String(r._id)),
    ).toEqual(ids);
});
it('refuses live-ledger replacement and refuses another running operator without explicit stale recovery', async () => {
    const raw = db.connection.db!;
    await raw
        .collection('stockmovements')
        .updateOne({ product, sequence: 0 }, { $set: { historical: false } });
    await expect(migrateStockLedger(db.connection, true)).rejects.toThrow(
        'Live ledger already exists',
    );
    await raw
        .collection('stockmovements')
        .updateOne({ product, sequence: 0 }, { $set: { historical: true } });
    await raw
        .collection('migrations')
        .updateOne(
            { _id: STOCK_LEDGER_MIGRATION as never },
            { $set: { status: 'running', owner: 'gone' } },
        );
    await expect(migrateStockLedger(db.connection, true)).rejects.toThrow(
        'already running',
    );
    await migrateStockLedger(db.connection, true, true);
});
it('rejects unsafe or orphan inventory without fabricating stock events', async () => {
    const raw = db.connection.db!;
    const orphan = new Types.ObjectId();
    await raw
        .collection('inventories')
        .insertOne({ product: orphan, stock: 1, createdAt: first });
    await expect(migrateStockLedger(db.connection, false)).rejects.toThrow(
        'Orphan inventory',
    );
    await raw.collection('inventories').deleteOne({ product: orphan });
    await raw
        .collection('inventories')
        .updateOne({ product }, { $set: { stock: 0.5 } });
    await expect(migrateStockLedger(db.connection, false)).rejects.toThrow(
        'Unsafe historical stock quantity',
    );
    await raw
        .collection('inventories')
        .updateOne({ product }, { $set: { stock: 14 } });
    expect(
        (
            await raw.collection('stockmovements').find({ product }).toArray()
        ).filter((r) => r.type === StockMovementType.OPENING),
    ).toHaveLength(1);
});
