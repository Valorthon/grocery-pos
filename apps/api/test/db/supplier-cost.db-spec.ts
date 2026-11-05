import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import {
    Role,
    UnitOfMeasure,
    quantityAmount,
    wireShapeDiff,
    SUPPLIER_SHAPE,
    type SupplierView,
    type ProductCostView,
    type OfflineCatalogPage,
    type OfflineLeaseView,
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
import { ProductService } from '../../src/product/product.service';

let db: DbApp;
const admin = caller('cost-admin', Role.Admin),
    restocker = caller('cost-restocker', Role.Restocker);
let supplier: string;
beforeAll(async () => {
    db = await bootDbApp();
    supplier = await seedSupplier(db);
    await db.model('User').create({
        _id: new Types.ObjectId(admin.userId),
        name: admin.username,
        roles: admin.roles,
        isActive: true,
        passwordHash: 'test',
    });
});
afterAll(async () => {
    await db?.close();
});
async function receive(
    product: string,
    cost: number,
    qty = 1,
    supplierId = supplier,
) {
    return db.call(restocker, 'POST', '/restocks', {
        supplier: supplierId,
        invoiceNumber: ' DR-123 ',
        description: 'Receipt',
        restockDetails: [{ product, quantity: qty, unitCost: cost }],
    });
}
async function cashier(): Promise<Caller> {
    const who = caller(`cost-${randomUUID().slice(0, 8)}`, Role.Seller);
    await db.model('User').create({
        _id: new Types.ObjectId(who.userId),
        name: who.username,
        roles: who.roles,
        isActive: true,
        passwordHash: 'test',
    });
    await openShift(db, who);
    return who;
}
async function costOf(product: string) {
    const result = await read<ProductCostView[]>(
        await db.call(admin, 'GET', `/suppliers/costs?products=${product}`),
    );
    expect(result.status).toBe(200);
    return result.body[0];
}
async function storedCost(sale: string): Promise<number | undefined> {
    const row = await db
        .model<{ unitCost?: number }>('SalesDetails')
        .findOne({ sales: sale })
        .select('+unitCost')
        .lean();
    return row?.unitCost;
}

it('validates supplier fields and protects procurement routes from sellers/adjusters', async () => {
    const created = await read<SupplierView>(
        await db.call(restocker, 'POST', '/suppliers', {
            name: '  Farm  ',
            contactPerson: ' Ana ',
            phone: ' +63 123 ',
            email: 'ana@example.com',
            TIN: ' 001-123 ',
        }),
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
        name: 'Farm',
        contactPerson: 'Ana',
        TIN: '001-123',
    });
    expect(wireShapeDiff(created.body, SUPPLIER_SHAPE)).toEqual({
        missing: [],
        unexpected: [],
    });
    for (const who of [
        caller('seller', Role.Seller),
        caller('adjuster', Role.Adjuster),
    ]) {
        expect((await db.call(who, 'GET', '/suppliers')).status).toBe(403);
        expect(
            (
                await db.call(
                    who,
                    'GET',
                    `/suppliers/costs?products=${new Types.ObjectId().toString()}`,
                )
            ).status,
        ).toBe(403);
    }
    expect(
        (
            await db.call(admin, 'POST', '/suppliers', {
                name: 'Bad',
                email: 'no',
            })
        ).status,
    ).toBe(400);
    expect(
        (
            await db.call(admin, 'PATCH', `/suppliers/${created.body._id}`, {
                isActive: null,
            })
        ).status,
    ).toBe(400);
});
it('requires an active supplier and retains receipt history through archive', async () => {
    const product = await seedProduct(db, 1000, 0),
        local = await seedSupplier(db);
    const missing = await db.call(restocker, 'POST', '/restocks', {
        description: 'Missing supplier',
        restockDetails: [{ product, quantity: 1, unitCost: 200 }],
    });
    expect(missing.status).toBe(400);
    expect((await receive(product, 200, 1, local)).status).toBe(201);
    expect((await db.call(admin, 'DELETE', `/suppliers/${local}`)).status).toBe(
        400,
    );
    expect(
        (
            await db.call(admin, 'PATCH', `/suppliers/${local}`, {
                isActive: false,
            })
        ).status,
    ).toBe(200);
    expect((await receive(product, 300, 1, local)).status).toBe(400);
    expect(await stockOf(db, product)).toBe(1);
    expect((await costOf(product)).lastCost).toBe(200);
    const history = await read<{
        data: { supplier?: { _id: string }; invoiceNumber?: string }[];
    }>(await db.call(restocker, 'GET', '/restocks?page=1&limit=100'));
    expect(
        history.body.data.find((row) => row.supplier?._id === local)
            ?.invoiceNumber,
    ).toBe('DR-123');
});
it('updates latest cost exactly for measured receipts and preserves known zero versus unknown', async () => {
    const product = await seedProduct(db, 18000, 0);
    await db
        .model('Product')
        .collection.updateOne(
            { _id: new Types.ObjectId(product) },
            { $set: { unit: UnitOfMeasure.KG } },
        );
    expect((await costOf(product)).lastCost).toBeUndefined();
    expect((await receive(product, 12000, 450)).status).toBe(201);
    expect(await costOf(product)).toMatchObject({
        lastCost: 12000,
        marginBasisPoints: 3333,
    });
    expect((await receive(product, 0, 450)).status).toBe(201);
    expect(await costOf(product)).toMatchObject({
        lastCost: 0,
        marginBasisPoints: 10000,
    });
    expect(quantityAmount(12000, 450, UnitOfMeasure.KG)).toBe(5400);
    const raw = await db
        .model<{ totalCost: number }>('Restock')
        .find()
        .sort({ _id: -1 })
        .lean();
    expect(raw[0].totalCost).toBe(0);
});
it('snapshots server cost on each sale, preserves unknown history and redacts cashier output', async () => {
    const product = await seedProduct(db, 1000, 10),
        who = await cashier();
    const unknown = await read<Receipt>(
        await db.call(who, 'POST', '/sales', cashSale(product, 1, 1000)),
    );
    expect(unknown.status).toBe(201);
    expect(await storedCost(unknown.body._id)).toBeUndefined();
    expect((await receive(product, 600)).status).toBe(201);
    const known = await read<Receipt>(
        await db.call(who, 'POST', '/sales', cashSale(product, 1, 1000)),
    );
    expect(known.status).toBe(201);
    expect(await storedCost(known.body._id)).toBe(600);
    expect((await receive(product, 900)).status).toBe(201);
    expect(await storedCost(known.body._id)).toBe(600);
    expect(await storedCost(unknown.body._id)).toBeUndefined();
    const sellerLines = await read<Record<string, unknown>[]>(
        await db.call(who, 'GET', `/sales/details/${known.body._id}`),
    );
    expect(sellerLines.status).toBe(200);
    expect(sellerLines.body[0]).not.toHaveProperty('unitCost');
    const adminLines = await read<Record<string, unknown>[]>(
        await db.call(admin, 'GET', `/sales/details/${known.body._id}`),
    );
    expect(adminLines.body[0].unitCost).toBe(600);
    const publicProduct = await read<Record<string, unknown>>(
        await db.call(
            who,
            'GET',
            `/products/${(await db.model<{ EAN: string }>('Product').findById(product).lean())!.EAN}`,
        ),
    );
    expect(publicProduct.body).not.toHaveProperty('lastCost');
    expect(JSON.stringify(known.body)).not.toContain('unitCost');
});
it('rolls back supplier receipt, stock and product cost together on a late failure', async () => {
    const product = await seedProduct(db, 1000, 0);
    expect((await receive(product, 250)).status).toBe(201);
    const before = await db.model('Restock').countDocuments();
    const service = db.app.get(ProductService),
        original = service.recordReceiptCosts.bind(service);
    const spy = jest
        .spyOn(service, 'recordReceiptCosts')
        .mockImplementationOnce(async (lines, session) => {
            await original(lines, session);
            throw new Error('late rollback probe');
        });
    try {
        expect((await receive(product, 800, 2)).status).toBe(500);
    } finally {
        spy.mockRestore();
    }
    expect(await stockOf(db, product)).toBe(1);
    expect((await costOf(product)).lastCost).toBe(250);
    expect(await db.model('Restock').countDocuments()).toBe(before);
});
it('serializes supplier archive with receipt without losing cost or creating an archived assignment', async () => {
    const product = await seedProduct(db, 1000, 0),
        local = await seedSupplier(db);
    const [receipt, archive] = await Promise.all([
        receive(product, 300, 1, local),
        db.call(admin, 'PATCH', `/suppliers/${local}`, { isActive: false }),
    ]);
    expect(archive.status).toBe(200);
    expect([201, 400]).toContain(receipt.status);
    expect(await stockOf(db, product)).toBe(receipt.status === 201 ? 1 : 0);
    expect((await costOf(product)).lastCost).toBe(
        receipt.status === 201 ? 300 : undefined,
    );
});
it('captures confidential offline catalogue cost, not later sync-time cost, including admin reconciliation', async () => {
    const product = await seedProduct(db, 1000, 10),
        who = await cashier();
    await db.model('RefreshToken').create({
        user: who.userId,
        family: who.userId,
        expiry: new Date(Date.now() + 3600000),
    });
    expect((await receive(product, 450)).status).toBe(201);
    const leased = await read<OfflineLeaseView>(
        await db.call(who, 'POST', '/offline/lease', {
            terminalId: randomUUID(),
        }),
    );
    expect(leased.status).toBe(201);
    const catalogue = await read<OfflineCatalogPage>(
        await db.call(who, 'GET', `/offline/catalog?lease=${leased.body._id}`),
    );
    const item = catalogue.body.products.find((row) => row._id === product)!;
    expect(item).toBeDefined();
    const decoded = db.app
        .get(JwtService)
        .decode<Record<string, unknown>>(item.proof);
    expect(decoded).toHaveProperty('costRef');
    expect(decoded).not.toHaveProperty('unitCost');
    expect(decoded).not.toHaveProperty('lastCost');
    expect(JSON.stringify(item)).not.toContain('lastCost');
    expect((await receive(product, 900)).status).toBe(201);
    const request = {
        lease: leased.body._id,
        soldAt: new Date().toISOString(),
        idempotencyKey: randomUUID(),
        amountTendered: 1000,
        lines: [{ product, quantity: 1, proof: item.proof }],
    };
    const response = await read<Receipt>(
        await db.call(who, 'POST', '/offline/sync', request),
    );
    expect(response.status).toBe(201);
    expect(await storedCost(response.body._id)).toBe(450);
    const replay = await read<Receipt>(
        await db.call(who, 'POST', '/offline/sync', request),
    );
    expect(replay.body._id).toBe(response.body._id);
    expect(await storedCost(replay.body._id)).toBe(450);
    await db
        .model('User')
        .updateOne({ _id: who.userId }, { $set: { isActive: false } });
    const reconciled = await read<Receipt>(
        await db.call(admin, 'POST', '/offline/reconcile', {
            ...request,
            idempotencyKey: randomUUID(),
            reason: 'Collected before deactivation',
        }),
    );
    expect(reconciled.status).toBe(201);
    expect(await storedCost(reconciled.body._id)).toBe(450);
});
it('keeps legacy signed offline proofs without cost evidence unknown', async () => {
    const product = await seedProduct(db, 1000, 10),
        who = await cashier();
    await db.model('RefreshToken').create({
        user: who.userId,
        family: who.userId,
        expiry: new Date(Date.now() + 3600000),
    });
    const leased = await read<OfflineLeaseView>(
        await db.call(who, 'POST', '/offline/lease', {
            terminalId: randomUUID(),
        }),
    );
    const catalogue = await read<OfflineCatalogPage>(
        await db.call(who, 'GET', `/offline/catalog?lease=${leased.body._id}`),
    );
    const item = catalogue.body.products.find((row) => row._id === product)!;
    const jwt = db.app.get(JwtService),
        payload = jwt.decode<Record<string, unknown>>(item.proof);
    delete payload.costRef;
    const proof = jwt.sign(payload, { secret: process.env.JWT_SECRET });
    expect((await receive(product, 700)).status).toBe(201);
    const response = await read<Receipt>(
        await db.call(who, 'POST', '/offline/sync', {
            lease: leased.body._id,
            soldAt: new Date().toISOString(),
            idempotencyKey: randomUUID(),
            amountTendered: 1000,
            lines: [{ product, quantity: 1, proof }],
        }),
    );
    expect(response.status).toBe(201);
    expect(await storedCost(response.body._id)).toBeUndefined();
});
