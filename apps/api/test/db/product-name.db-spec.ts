import { Types } from 'mongoose';
import { ErrorCode, ProductView, Paginated } from '@grocery-pos/contracts';
import { bootDbApp, caller, nextEan, read, type DbApp } from './db-app';
import { Role } from '../../src/auth/types';
import { Product } from '../../src/product/product.schema';
import { migrateUppercaseProductNames } from '../../src/migrations/uppercase-product-names';

// #443: product names are stored and shown in UPPERCASE.
let db: DbApp;
const restocker = caller('name-restocker', Role.Restocker);
beforeAll(async () => {
    db = await bootDbApp();
});
afterAll(async () => {
    await db?.close();
});

it('stores the uppercase name, refuses a case variant and finds it by any case', async () => {
    const created = await db.call(restocker, 'POST', '/products/bulk', {
        newProducts: [{ name: '  E2E Test Rice 1kg ', price: 100 }],
    });
    expect(created.status).toBe(201);
    const stored = await db
        .model<Product>('Product')
        .findOne({ name: 'E2E TEST RICE 1KG' })
        .lean();
    expect(stored).not.toBeNull();

    const duplicate = await read<{ error: string }>(
        await db.call(restocker, 'POST', '/products/bulk', {
            newProducts: [{ name: 'e2e test rice 1KG', price: 100 }],
        }),
    );
    expect(duplicate.status).toBe(400);
    expect([ErrorCode.PRODUCT_DUPLICATE, ErrorCode.DB_DUPLICATE_KEY]).toContain(
        duplicate.body.error,
    );

    const search = await read<Paginated<ProductView>>(
        await db.call(restocker, 'GET', '/products?page=1&limit=10&name=rice'),
    );
    expect(search.status).toBe(200);
    expect(search.body.data.map((p) => p.name)).toContain('E2E TEST RICE 1KG');
});

it('migrates legacy names: dry run, apply, idempotent rerun, collisions refused', async () => {
    const products = db.connection.db!.collection('products');
    const now = new Date();
    const legacy = (name: string) => ({
        _id: new Types.ObjectId(),
        EAN: nextEan(),
        name,
        price: 100,
        createdAt: now,
        updatedAt: now,
    });
    const a = legacy('legacy bread');
    await products.insertOne(a);

    const dry = await migrateUppercaseProductNames(db.connection, false);
    expect(dry.toUppercase).toBeGreaterThanOrEqual(1);
    expect((await products.findOne({ _id: a._id }))?.name).toBe('legacy bread');

    await migrateUppercaseProductNames(db.connection, true);
    expect((await products.findOne({ _id: a._id }))?.name).toBe('LEGACY BREAD');
    expect(
        (await migrateUppercaseProductNames(db.connection, true)).toUppercase,
    ).toBe(0);

    // Two legacy rows that only differ by case: refused, nothing written.
    const b = legacy('legacy jam');
    const c = legacy('Legacy Jam');
    await products.insertMany([b, c]);
    await expect(
        migrateUppercaseProductNames(db.connection, true),
    ).rejects.toThrow('LEGACY JAM');
    expect((await products.findOne({ _id: b._id }))?.name).toBe('legacy jam');
    expect((await products.findOne({ _id: c._id }))?.name).toBe('Legacy Jam');
});

it('refuses a bulk save naming every clash, inserting nothing (#470)', async () => {
    const takenEAN = nextEan();
    const seeded = await db.call(restocker, 'POST', '/products/bulk', {
        newProducts: [
            { name: 'CLASH SUGAR', price: 100 },
            { name: 'CLASH SALT', price: 100, EAN: takenEAN },
        ],
    });
    expect(seeded.status).toBe(201);

    const res = await read<{ error: string; details: unknown }>(
        await db.call(restocker, 'POST', '/products/bulk', {
            newProducts: [
                { name: 'clash sugar', price: 100 },
                { name: 'CLASH NEW', price: 100, EAN: takenEAN },
                { name: 'CLASH SALT', price: 100 },
                { name: 'CLASH NEW', price: 100 },
            ],
        }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(ErrorCode.DB_DUPLICATE_KEY);
    expect(res.body.details).toEqual([
        { property: 'name', msg: 'Already exists', index: 0 },
        { property: 'EAN', msg: 'Already exists', index: 1 },
        { property: 'name', msg: 'Already exists', index: 2 },
        { property: 'name', msg: 'Repeated in this list', index: 3 },
    ]);
    expect(
        await db
            .model<Product>('Product')
            .countDocuments({ name: 'CLASH NEW' }),
    ).toBe(0);
});
