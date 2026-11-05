import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
    CategoryDto,
    CATEGORY_SHAPE,
    Paginated,
    wireShapeDiff,
} from '@grocery-pos/contracts';
import { bootDbApp, caller, productDocs, read, type DbApp } from './db-app';
import { Role } from '../../src/auth/types';
import { Category } from '../../src/category/category.schema';
import { Product } from '../../src/product/product.schema';
import { migrateCategories } from '../../src/migrations/categories';
let db: DbApp;
const admin = caller('category-admin', Role.Admin),
    restocker = caller('category-restocker', Role.Restocker);
beforeAll(async () => {
    db = await bootDbApp();
});
afterAll(async () => {
    await db?.close();
});
async function create(name = `Frozen ${randomUUID()}`) {
    const response = await read<CategoryDto>(
        await db.call(admin, 'POST', '/categories', { name }),
    );
    expect(response.status).toBe(201);
    expect(wireShapeDiff(response.body, CATEGORY_SHAPE)).toEqual({
        missing: [],
        unexpected: [],
    });
    return response.body;
}
async function product(category?: string, isActive = true) {
    const fixture = productDocs(100, 10);
    await db
        .model<Product>('Product')
        .create({ ...fixture.product, category, isActive });
    return fixture.product._id.toString();
}
it('enforces admin management and lets product roles list categories', async () => {
    for (const role of [
        Role.Restocker,
        Role.Adjuster,
        Role.Seller,
        Role.UserManager,
        Role.Supervisor,
    ]) {
        expect(
            (
                await db.call(
                    caller(randomUUID(), role),
                    'POST',
                    '/categories',
                    { name: randomUUID() },
                )
            ).status,
        ).toBe(403);
    }
    const row = await create('Frozen');
    const list = await read<Paginated<CategoryDto>>(
        await db.call(restocker, 'GET', '/categories?page=1&limit=100'),
    );
    expect(list.status).toBe(200);
    expect(list.body.data.find((item) => item._id === row._id)).toEqual(row);
    expect(row).not.toHaveProperty('nameKey');
    expect(row).not.toHaveProperty('assignmentVersion');
});
it('enforces case-insensitive uniqueness under concurrent creation and rename', async () => {
    const name = `Unique${randomUUID()}`;
    const responses = await Promise.all([
        db.call(admin, 'POST', '/categories', { name }),
        db.call(admin, 'POST', '/categories', { name: name.toUpperCase() }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
    const row = await create();
    expect(
        (
            await db.call(admin, 'PATCH', `/categories/${row._id}`, {
                name: name.toLowerCase(),
            })
        ).status,
    ).toBe(400);
    expect(
        (await db.model<Category>('Category').findById(row._id).lean())?.name,
    ).toBe(row.name);
});
it('assigns active ObjectId categories and filters product rows without deploying', async () => {
    const row = await create();
    const id = await product();
    expect(
        (
            await db.call(restocker, 'PATCH', '/products', {
                updates: [{ product: id, update: { category: row._id } }],
            })
        ).status,
    ).toBe(200);
    const result = await read<Paginated<{ _id: string; category: string }>>(
        await db.call(
            admin,
            'GET',
            `/products?page=1&limit=100&category=${row._id}`,
        ),
    );
    expect(result.body.data.map((p) => p._id)).toEqual([id]);
    expect(result.body.data[0].category).toBe(row._id);
    expect(
        (
            await db.call(restocker, 'PATCH', '/products', {
                updates: [{ product: id, update: { category: null } }],
            })
        ).status,
    ).toBe(200);
    expect(
        (await db.model<Product>('Product').findById(id).lean())?.category,
    ).toBeUndefined();
});
it('keeps referenced categories, archives without changing products, permits unchanged assignments', async () => {
    const row = await create();
    const id = await product(row._id);
    expect(
        (await db.call(admin, 'DELETE', `/categories/${row._id}`)).status,
    ).toBe(400);
    expect(
        (
            await db.call(admin, 'PATCH', `/categories/${row._id}`, {
                isActive: false,
            })
        ).status,
    ).toBe(200);
    expect(
        (
            await db.call(restocker, 'PATCH', '/products', {
                updates: [
                    {
                        product: id,
                        update: { name: randomUUID(), category: row._id },
                    },
                ],
            })
        ).status,
    ).toBe(200);
    const other = await product();
    expect(
        (
            await db.call(restocker, 'PATCH', '/products', {
                updates: [
                    {
                        product: other,
                        update: { category: row._id, price: 200 },
                    },
                ],
            })
        ).status,
    ).toBe(403);
    expect(
        (
            await db.call(admin, 'PATCH', '/products', {
                updates: [
                    {
                        product: other,
                        update: { category: row._id, price: 200 },
                    },
                ],
            })
        ).status,
    ).toBe(400);
    expect(
        (await db.model<Product>('Product').findById(other).lean())?.price,
    ).toBe(100);
    const stored = await db.model<Product>('Product').findById(id).lean();
    expect(stored?.isActive).toBe(true);
    expect(String(stored?.category)).toBe(row._id);
    expect(
        (
            await db.call(admin, 'PATCH', `/categories/${row._id}`, {
                isActive: true,
            })
        ).status,
    ).toBe(200);
});
it('retains references from archived products and deletes only unused categories', async () => {
    const row = await create();
    await product(row._id, false);
    expect(
        (await db.call(admin, 'DELETE', `/categories/${row._id}`)).status,
    ).toBe(400);
    const unused = await create();
    expect(
        (await db.call(admin, 'DELETE', `/categories/${unused._id}`)).status,
    ).toBe(200);
    expect(
        await db.model<Category>('Category').findById(unused._id),
    ).toBeNull();
    expect(
        (await db.call(admin, 'DELETE', `/categories/${unused._id}`)).status,
    ).toBe(404);
});
it('validates bounded list and complete category state', async () => {
    const row = await create();
    for (const body of [
        { isActive: null },
        { sortOrder: null },
        { name: '' },
        {},
    ])
        expect(
            (await db.call(admin, 'PATCH', `/categories/${row._id}`, body))
                .status,
        ).toBe(400);
    expect(
        (
            await db.call(admin, 'POST', '/categories', {
                name: 'null order',
                sortOrder: null,
            })
        ).status,
    ).toBe(400);
    expect((await db.call(admin, 'GET', '/categories?limit=101')).status).toBe(
        400,
    );
    expect(
        (await db.call(admin, 'GET', '/products?page=1&limit=10&category=FOOD'))
            .status,
    ).toBe(400);
    expect(
        (
            await db.call(restocker, 'POST', '/products/bulk', {
                newProducts: [
                    { name: randomUUID(), price: 100, category: 'FOOD' },
                ],
            })
        ).status,
    ).toBe(400);
});
it('serializes archive/assignment so neither leaves an orphan or partial product edit', async () => {
    const row = await create();
    const id = await product();
    const [archive, assign] = await Promise.all([
        db.call(admin, 'PATCH', `/categories/${row._id}`, { isActive: false }),
        db.call(admin, 'PATCH', '/products', {
            updates: [
                { product: id, update: { category: row._id, price: 200 } },
            ],
        }),
    ]);
    expect(archive.status).toBe(200);
    expect([200, 400]).toContain(assign.status);
    const p = await db.model<Product>('Product').findById(id).lean();
    expect(p?.price).toBe(assign.status === 200 ? 200 : 100);
    expect(p?.category?.toString()).toBe(
        assign.status === 200 ? row._id : undefined,
    );
});
it('serializes delete against first assignment', async () => {
    const row = await create();
    const id = await product();
    const [remove, assign] = await Promise.all([
        db.call(admin, 'DELETE', `/categories/${row._id}`),
        db.call(admin, 'PATCH', '/products', {
            updates: [{ product: id, update: { category: row._id } }],
        }),
    ]);
    expect([200, 400]).toContain(remove.status);
    expect([200, 400]).toContain(assign.status);
    const p = await db.model<Product>('Product').findById(id).lean();
    if (p?.category)
        expect(
            await db.model<Category>('Category').findById(p.category),
        ).not.toBeNull();
    expect(remove.status === 200 && assign.status === 200).toBe(false);
});
it('migrates enum strings atomically, reruns safely and keeps uncategorized rows', async () => {
    const id = await product();
    const noCategory = await product();
    await db
        .model<Product>('Product')
        .collection.updateOne(
            { _id: new Types.ObjectId(id) },
            { $set: { category: 'FOOD' } },
        );
    const dry = await migrateCategories(db.connection, false);
    expect(dry.find((row) => row.name === 'FOOD')?.products).toBe(1);
    const raw = await db
        .model<Product>('Product')
        .collection.findOne({ _id: new Types.ObjectId(id) });
    expect(raw?.category).toBe('FOOD');
    await migrateCategories(db.connection, true);
    const first = (await db.model<Product>('Product').findById(id).lean())
        ?.category;
    expect(first).toBeInstanceOf(Types.ObjectId);
    await migrateCategories(db.connection, true);
    expect(
        (await db.model<Product>('Product').findById(id).lean())?.category,
    ).toEqual(first);
    expect(
        (await db.model<Product>('Product').findById(noCategory).lean())
            ?.category,
    ).toBeUndefined();
    const unknown = await product();
    await db
        .model<Product>('Product')
        .collection.updateOne(
            { _id: new Types.ObjectId(unknown) },
            { $set: { category: 'UNKNOWN' } },
        );
    await expect(migrateCategories(db.connection, true)).rejects.toThrow(
        'Unknown category',
    );
});
