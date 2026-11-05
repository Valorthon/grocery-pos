import { randomUUID } from 'node:crypto';
import { Role, type ProductView, type Paginated } from '@grocery-pos/contracts';
import {
    bootDbApp,
    caller,
    openShift,
    productDocs,
    cashSale,
    read,
    stockOf,
    type DbApp,
} from './db-app';
import { Product, type ProductDoc } from '../../src/product/product.schema';
let db: DbApp;
const admin = caller('edit-admin', Role.Admin);
const restocker = caller('edit-restocker', Role.Restocker);
beforeAll(async () => {
    db = await bootDbApp();
});
afterAll(async () => {
    await db?.close();
});
async function fixture() {
    const docs = productDocs(100, 10);
    await db.model('Product').create(docs.product);
    await db.model('Inventory').create(docs.inventory);
    return docs;
}
it('edits prices as admin with atomic history; restocker cannot change prices', async () => {
    const docs = await fixture();
    const id = String(docs.product._id);
    expect(
        (
            await db.call(restocker, 'PATCH', '/products', {
                updates: [{ product: id, update: { price: 200 } }],
            })
        ).status,
    ).toBe(403);
    expect(
        (
            await db.call(admin, 'PATCH', '/products', {
                updates: [{ product: id, update: { price: 200 } }],
            })
        ).status,
    ).toBe(200);
    const stored = await db
        .model<Product>('Product')
        .findById(id)
        .select('+priceHistory')
        .lean();
    expect(stored?.price).toBe(200);
    expect(stored?.priceHistory).toMatchObject([
        { oldPrice: 100, newPrice: 200, changedBy: admin.userId },
    ]);
    const seller = caller(randomUUID(), Role.Seller);
    await openShift(db, seller);
    const sale = await read<{ totalAmount: number }>(
        await db.call(seller, 'POST', '/sales', cashSale(id, 1, 200)),
    );
    expect(sale.status).toBe(201);
    expect(sale.body.totalAmount).toBe(200);
});
it('archives without removing stock/history, blocks scans/search/sales, and restores', async () => {
    const docs = await fixture();
    const id = String(docs.product._id);
    const seller = caller(randomUUID(), Role.Seller);
    await openShift(db, seller);
    expect(
        (
            await db.call(restocker, 'PATCH', '/products', {
                updates: [{ product: id, update: { isActive: false } }],
            })
        ).status,
    ).toBe(200);
    const scan = await db.call(seller, 'GET', `/products/${docs.product.EAN}`);
    expect(scan.status).toBe(400);
    expect(await scan.text()).toContain('Product discontinued');
    const matches = await read<unknown[]>(
        await db.call(
            seller,
            'GET',
            `/products/matches?EAN=${docs.product.EAN}`,
        ),
    );
    expect(matches.body).toEqual([]);
    expect(
        (await db.call(seller, 'POST', '/sales', cashSale(id, 1, 100))).status,
    ).toBe(400);
    expect(await stockOf(db, id)).toBe(10);
    const list = await read<Paginated<ProductView>>(
        await db.call(
            admin,
            'GET',
            '/products?page=1&limit=100&status=archived',
        ),
    );
    expect(list.body.data.some((p) => p._id === id)).toBe(true);
    expect(
        (
            await db.call(admin, 'PATCH', '/products', {
                updates: [{ product: id, update: { isActive: true } }],
            })
        ).status,
    ).toBe(200);
    expect(
        (await db.call(seller, 'POST', '/sales', cashSale(id, 1, 100))).status,
    ).toBe(201);
});
it('rolls back prior edits and price history if any referenced product is missing', async () => {
    const docs = await fixture();
    const id = String(docs.product._id);
    const missing = '507f1f77bcf86cd799439000';
    expect(
        (
            await db.call(admin, 'PATCH', '/products', {
                updates: [
                    { product: id, update: { price: 900 } },
                    { product: missing, update: { name: 'missing' } },
                ],
            })
        ).status,
    ).toBe(404);
    const stored = await db
        .model<Product>('Product')
        .findById(id)
        .select('+priceHistory')
        .lean();
    expect(stored?.price).toBe(100);
    expect(stored?.priceHistory).toBeUndefined();
});
it('legacy documents without isActive remain visible and editable', async () => {
    const docs = await fixture();
    const id = String(docs.product._id);
    await db
        .model<Product>('Product')
        .collection.updateOne(
            { _id: docs.product._id },
            { $unset: { isActive: '' } },
        );
    const list = await read<Paginated<ProductDoc>>(
        await db.call(admin, 'GET', '/products?page=1&limit=100'),
    );
    expect(list.body.data.some((p) => String(p._id) === id)).toBe(true);
    expect(
        (
            await db.call(restocker, 'PATCH', '/products', {
                updates: [
                    {
                        product: id,
                        update: { name: `renamed-${randomUUID()}` },
                    },
                ],
            })
        ).status,
    ).toBe(200);
});
it('serializes archive with checkout and leaves no sale accepted after archival', async () => {
    const docs = await fixture();
    const id = String(docs.product._id);
    const seller = caller(randomUUID(), Role.Seller);
    await openShift(db, seller);
    const results = await Promise.all([
        db.call(admin, 'PATCH', '/products', {
            updates: [{ product: id, update: { isActive: false } }],
        }),
        db.call(seller, 'POST', '/sales', cashSale(id, 1, 100)),
    ]);
    expect(results[0].status).toBe(200);
    expect([201, 400]).toContain(results[1].status);
    expect(await stockOf(db, id)).toBe(results[1].status === 201 ? 9 : 10);
    expect(
        (await db.call(seller, 'POST', '/sales', cashSale(id, 1, 100))).status,
    ).toBe(400);
});

it('never exposes internal price-history or checkout lock fields in product responses', async () => {
    const docs = await fixture();
    const id = String(docs.product._id);
    await db.call(admin, 'PATCH', '/products', {
        updates: [{ product: id, update: { price: 200 } }],
    });
    const seller = caller(randomUUID(), Role.Seller);
    await openShift(db, seller);
    expect(
        (await db.call(seller, 'POST', '/sales', cashSale(id, 1, 200))).status,
    ).toBe(201);
    const product = await read<Record<string, unknown>>(
        await db.call(admin, 'GET', `/products/${docs.product.EAN}`),
    );
    expect(product.body).not.toHaveProperty('priceHistory');
    expect(product.body).not.toHaveProperty('saleVersion');
    const inventory = await read<
        Paginated<{ product: Record<string, unknown> }>
    >(await db.call(admin, 'GET', '/inventories?page=1&limit=100'));
    const row = inventory.body.data.find((r) => r.product._id === id);
    expect(row?.product).not.toHaveProperty('priceHistory');
    expect(row?.product).not.toHaveProperty('saleVersion');
});

it('rejects null archival state rather than returning a non-boolean wire field', async () => {
    const docs = await fixture();
    expect(
        (
            await db.call(admin, 'PATCH', '/products', {
                updates: [
                    {
                        product: String(docs.product._id),
                        update: { name: 'valid name', isActive: null },
                    },
                ],
            })
        ).status,
    ).toBe(400);
});
