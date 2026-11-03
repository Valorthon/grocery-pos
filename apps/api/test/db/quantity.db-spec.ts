import { randomUUID } from 'node:crypto';
import {
    UnitOfMeasure,
    type Receipt,
    OverrideAction,
    DiscountType,
} from '@grocery-pos/contracts';
import { Role } from '../../src/auth/types';
import {
    bootDbApp,
    caller,
    cashSale,
    openShift,
    productDocs,
    read,
    stockOf,
    type DbApp,
    type Caller,
} from './db-app';
import { approvalHeaders, discountApprovalHeaders } from './approval-fixtures';

let db: DbApp;
let seller: Caller;
const admin = caller('quantity-admin', Role.Admin);
beforeAll(async () => {
    db = await bootDbApp();
});
afterAll(async () => {
    await db?.close();
});
beforeEach(async () => {
    seller = caller(`weighed-${randomUUID().slice(0, 8)}`, Role.Seller);
    await openShift(db, seller);
});
async function product(unit: UnitOfMeasure, price = 18000, stock = 450000) {
    const docs = productDocs(price, stock);
    await db.model('Product').create({ ...docs.product, unit });
    await db.model('Inventory').create(docs.inventory);
    return String(docs.product._id);
}
it('charges 0.450kg at ₱180/kg as ₱81 and replays the snapshotted measure without another decrement', async () => {
    const id = await product(UnitOfMeasure.KG);
    const body = cashSale(id, 450, 8100);
    const response = await read<Receipt>(
        await db.call(seller, 'POST', '/sales', body),
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
        subtotal: 8100,
        totalAmount: 8100,
        items: [{ quantity: 450, unit: 'KG', unitPrice: 18000, amount: 8100 }],
    });
    const replay = await read<Receipt>(
        await db.call(seller, 'POST', '/sales', body),
    );
    expect(replay.body).toEqual(response.body);
    expect(await stockOf(db, id)).toBe(449550);
    const line = await db
        .model('SalesDetails')
        .findOne({ sales: response.body._id })
        .lean();
    expect(line).toMatchObject({ quantity: 450, unit: 'KG', unitPrice: 18000 });
});
it('decrements 1000 consecutive 0.450kg sales exactly, without floating-point drift', async () => {
    const id = await product(UnitOfMeasure.KG);
    for (let index = 0; index < 1000; index++) {
        const response = await db.call(
            seller,
            'POST',
            '/sales',
            cashSale(id, 450, 8100),
        );
        if (response.status !== 201)
            throw new Error(
                `sale ${index}: ${response.status} ${await response.text()}`,
            );
    }
    expect(await stockOf(db, id)).toBe(0);
    expect(await db.model('SalesDetails').countDocuments({ product: id })).toBe(
        1000,
    );
}, 240000);
it('cannot oversell under concurrent weighed checkouts', async () => {
    const id = await product(UnitOfMeasure.KG, 18000, 450);
    const responses = await Promise.all(
        [1, 2].map(() =>
            db.call(seller, 'POST', '/sales', cashSale(id, 450, 8100)),
        ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await stockOf(db, id)).toBe(0);
});
it.each([UnitOfMeasure.PIECE, UnitOfMeasure.KG])(
    'rejects fractional minor units for %s at the request boundary',
    async (unit) => {
        const id = await product(unit, 100, 100);
        expect(
            (await db.call(seller, 'POST', '/sales', cashSale(id, 0.45, 100)))
                .status,
        ).toBe(400);
        expect(await stockOf(db, id)).toBe(100);
    },
);
it('restocks kilograms at per-kg cost, adjusts grams and restores the exact sold quantity on reversal', async () => {
    const id = await product(UnitOfMeasure.KG, 18000, 0);
    expect(
        (
            await db.call(admin, 'POST', '/restocks', {
                description: 'weighed delivery',
                restockDetails: [
                    { product: id, quantity: 1250, unitCost: 10000 },
                ],
            })
        ).status,
    ).toBe(201);
    const restock = await db
        .model('Restock')
        .findOne({ description: 'weighed delivery' })
        .lean();
    expect(restock).toMatchObject({ totalCost: 12500 });
    expect(await stockOf(db, id)).toBe(1250);
    expect(
        (
            await db.call(admin, 'POST', '/adjustments', {
                description: 'weighed waste',
                adjustDetails: [{ product: id, change: -50, reason: 'waste' }],
            })
        ).status,
    ).toBe(201);
    expect(await stockOf(db, id)).toBe(1200);
    const sold = await read<Receipt>(
        await db.call(seller, 'POST', '/sales', cashSale(id, 450, 8100)),
    );
    const context = { reversal: { saleId: sold.body._id, reason: 'return' } };
    const headers = await approvalHeaders(
        db,
        seller,
        OverrideAction.REFUND,
        context,
    );
    expect(
        (
            await db.call(
                seller,
                'POST',
                `/sales/${sold.body._id}/refund`,
                { reason: 'return' },
                headers,
            )
        ).status,
    ).toBe(201);
    expect(await stockOf(db, id)).toBe(1200);
});
it('uses the same exact weighed subtotal for admin discount approval and checkout', async () => {
    const id = await product(UnitOfMeasure.L, 18000, 1000);
    const body = {
        ...cashSale(id, 450, 7290),
        discount: { type: DiscountType.PERCENT, value: 10, reason: 'approved' },
    };
    const headers = await discountApprovalHeaders(db, seller, body);
    const response = await read<Receipt>(
        await db.call(seller, 'POST', '/sales', body, headers),
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
        subtotal: 8100,
        totalAmount: 7290,
        discount: { amount: 810 },
    });
});
it('normalizes low-stock filters by displayed units while retaining piece semantics', async () => {
    const kg = await product(UnitOfMeasure.KG, 100, 9000);
    const highKg = await product(UnitOfMeasure.KG, 100, 11000);
    const piece = await product(UnitOfMeasure.PIECE, 100, 9);
    const response = await read<{ data: { product: { _id: string } }[] }>(
        await db.call(
            admin,
            'GET',
            '/inventories?page=1&limit=100&maxStock=10',
        ),
    );
    expect(response.status).toBe(200);
    const ids = response.body.data.map((r) => r.product._id);
    expect(ids).toContain(kg);
    expect(ids).toContain(piece);
    expect(ids).not.toContain(highKg);
});
it('refuses unit edits so stock and legacy history cannot be reinterpreted', async () => {
    const id = await product(UnitOfMeasure.KG);
    expect(
        (
            await db.call(admin, 'PATCH', '/products', {
                updates: [{ product: id, update: { unit: 'PIECE' } }],
            })
        ).status,
    ).toBe(400);
});
