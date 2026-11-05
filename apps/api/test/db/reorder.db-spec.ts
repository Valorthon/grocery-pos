import { Role, UnitOfMeasure, type ProductView } from '@grocery-pos/contracts';
import { bootDbApp, caller, productDocs, read, type DbApp } from './db-app';
let db: DbApp;
const restocker = caller('reorder-restocker', Role.Restocker);
const adjuster = caller('reorder-adjuster', Role.Adjuster);
beforeAll(async () => {
    db = await bootDbApp();
});
afterAll(async () => {
    await db?.close();
});
it('restockers change exact minor-unit reorder settings without changing the selling price', async () => {
    const docs = productDocs(18000, 500);
    await db
        .model('Product')
        .create({ ...docs.product, unit: UnitOfMeasure.KG });
    await db.model('Inventory').create(docs.inventory);
    const body = {
        updates: [
            {
                product: String(docs.product._id),
                update: { reorderLevel: 450, reorderQuantity: 2500 },
            },
        ],
    };
    expect((await db.call(adjuster, 'PATCH', '/products', body)).status).toBe(
        403,
    );
    expect((await db.call(restocker, 'PATCH', '/products', body)).status).toBe(
        200,
    );
    const response = await read<ProductView>(
        await db.call(restocker, 'GET', `/products/${docs.product.EAN}`),
    );
    expect(response.body).toMatchObject({
        price: 18000,
        unit: UnitOfMeasure.KG,
        reorderLevel: 450,
        reorderQuantity: 2500,
    });
    expect(
        (
            await db.call(restocker, 'PATCH', '/products', {
                updates: [
                    {
                        product: String(docs.product._id),
                        update: { price: 1, reorderLevel: 0 },
                    },
                ],
            })
        ).status,
    ).toBe(403);
    const unchanged = await db
        .model('Product')
        .findById(docs.product._id)
        .lean();
    expect(unchanged).toMatchObject({ price: 18000, reorderLevel: 450 });
});
it('rejects null, fractional and unsafe reorder settings before any write', async () => {
    const docs = productDocs(100, 5);
    await db.model('Product').create(docs.product);
    for (const update of [
        { reorderLevel: null },
        { reorderLevel: 0.5 },
        { reorderQuantity: 0 },
        { reorderLevel: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
        expect(
            (
                await db.call(restocker, 'PATCH', '/products', {
                    updates: [{ product: String(docs.product._id), update }],
                })
            ).status,
        ).toBe(400);
    }
    expect(
        await db.model('Product').findById(docs.product._id).lean(),
    ).not.toHaveProperty('reorderLevel');
});

it('matches dashboard/list counts, includes zero/negative, excludes archived/orphan rows and sorts by display shortage', async () => {
    const admin = caller('reorder-admin', Role.Admin);
    await db.model('Inventory').deleteMany({});
    const create = async (
        name: string,
        stock: number,
        unit = UnitOfMeasure.PIECE,
        level?: number,
        active = true,
    ) => {
        const docs = productDocs(100, stock);
        await db.model('Product').create({
            ...docs.product,
            name,
            unit,
            isActive: active,
            ...(level !== undefined && { reorderLevel: level }),
        });
        await db
            .model('Inventory')
            .create({ ...docs.inventory, stock: Math.max(0, stock) });
        if (stock < 0)
            await db
                .model('Inventory')
                .collection.updateOne(
                    { product: docs.product._id },
                    { $set: { stock, offlineShortfall: true } },
                );
        return String(docs.product._id);
    };
    const highShortage = await create('z deficit', -2, UnitOfMeasure.PIECE, 8); // 10 displayed shortage
    const kg = await create('a rice', 450, UnitOfMeasure.KG, 9000); // 8.550 kg shortage
    const zero = await create('zero', 0, UnitOfMeasure.PIECE, 0);
    const edge = await create('edge', 3, UnitOfMeasure.PIECE, 3);
    const above = await create('above', 4, UnitOfMeasure.PIECE, 3);
    const archived = await create(
        'archived',
        -100,
        UnitOfMeasure.PIECE,
        50,
        false,
    );
    const legacy = await create('legacy', 9500, UnitOfMeasure.KG); // legacy 10kg level
    const orphan = productDocs(100, 0);
    await db.model('Inventory').create(orphan.inventory);
    const first = await read<{
        data: { product: ProductView; stock: number }[];
        totalItems: number;
    }>(
        await db.call(
            admin,
            'GET',
            '/inventories?page=1&limit=2&lowStock=true',
        ),
    );
    expect(first.status).toBe(200);
    expect(first.body.totalItems).toBe(5);
    expect(first.body.data.map((row) => row.product._id)).toEqual([
        highShortage,
        kg,
    ]);
    const all = await read<{
        data: { product: ProductView }[];
        totalItems: number;
    }>(
        await db.call(
            admin,
            'GET',
            '/inventories?page=1&limit=100&lowStock=true',
        ),
    );
    expect(all.body.data.map((row) => row.product._id)).toEqual([
        highShortage,
        kg,
        legacy,
        edge,
        zero,
    ]);
    expect(JSON.stringify(all.body)).not.toContain('__reorderSeverity');
    expect(all.body.data.map((row) => row.product._id)).not.toEqual(
        expect.arrayContaining([above, archived]),
    );
    const dashboard = await read<{
        lowStockCount: number;
        outOfStockCount: number;
    }>(await db.call(admin, 'GET', '/dashboard'));
    expect(dashboard.body).toMatchObject({
        lowStockCount: all.body.totalItems,
        outOfStockCount: 2,
    });
    const second = await read<{ data: { product: ProductView }[] }>(
        await db.call(
            admin,
            'GET',
            '/inventories?page=2&limit=2&lowStock=true',
        ),
    );
    expect(second.body.data.map((row) => row.product._id)).toEqual([
        legacy,
        edge,
    ]);
    expect(
        (
            await db.call(
                admin,
                'GET',
                '/inventories?page=1&limit=100&lowStock=invalid',
            )
        ).status,
    ).toBe(400);
});
