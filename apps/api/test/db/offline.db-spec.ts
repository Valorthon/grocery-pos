import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
    wireShapeDiff,
    OFFLINE_LEASE_SHAPE,
    OFFLINE_PENDING_DETAILS_SHAPE,
    OFFLINE_CATALOG_SHAPE,
    OFFLINE_PRODUCT_SHAPE,
    CURRENT_SHIFT_VIEW_SHAPE,
    RECEIPT_SHAPE,
    ErrorCode,
    Role,
    UnitOfMeasure,
    type OfflineCatalogPage,
    type OfflineLeaseView,
    type OfflineSaleRequest,
    type Receipt,
    type AppErrorResponse,
} from '@grocery-pos/contracts';
import {
    bootDbApp,
    caller,
    openShift,
    productDocs,
    read,
    stockOf,
    type DbApp,
    type Caller,
} from './db-app';
import { OfflineLease } from '../../src/offline/offline-lease.schema';
import { Product } from '../../src/product/product.schema';
import { User } from '../../src/user/user.schema';
import { RefreshToken } from '../../src/auth/refresh-token/refresh-token.schema';
import { Shift } from '../../src/shift/shift.schema';
import { Sales } from '../../src/sales/sales.schema';
import { StockMovement } from '../../src/stock-movement/stock-movement.schema';
let db: DbApp;
let seller: Caller;
let admin: Caller;
let lease: OfflineLeaseView;
let product: string;
let body: OfflineSaleRequest;
let terminalId: string;
beforeAll(async () => {
    db = await bootDbApp();
});
afterAll(async () => {
    await db?.close();
});
beforeEach(async () => {
    seller = caller(`offline-${randomUUID().slice(0, 8)}`, Role.Seller);
    admin = caller(`admin-${randomUUID().slice(0, 8)}`, Role.Admin);
    await db.model<User>('User').create(
        [seller, admin].map((u) => ({
            _id: new Types.ObjectId(u.userId),
            name: u.username,
            roles: u.roles,
            isActive: true,
            passwordHash: 'test-only',
        })),
    );
    await db.model<RefreshToken>('RefreshToken').create({
        user: seller.userId,
        family: seller.userId,
        expiry: new Date(Date.now() + 3600000),
    });
    await openShift(db, seller);
    const docs = productDocs(18000, 450);
    product = String(docs.product._id);
    await db
        .model('Product')
        .create({ ...docs.product, unit: UnitOfMeasure.KG });
    await db.model('Inventory').create(docs.inventory);
    terminalId = randomUUID();
    const leased = await read<OfflineLeaseView>(
        await db.call(seller, 'POST', '/offline/lease', { terminalId }),
    );
    if (leased.status !== 201) throw new Error(JSON.stringify(leased));
    lease = leased.body;
    expect(wireShapeDiff(lease, OFFLINE_LEASE_SHAPE)).toEqual({
        missing: [],
        unexpected: [],
    });
    expect(wireShapeDiff(lease.shift, CURRENT_SHIFT_VIEW_SHAPE)).toEqual({
        missing: [],
        unexpected: [],
    });
    const catalogue = await read<OfflineCatalogPage>(
        await db.call(seller, 'GET', `/offline/catalog?lease=${lease._id}`),
    );
    if (catalogue.status !== 200) throw new Error(JSON.stringify(catalogue));
    expect(wireShapeDiff(catalogue.body, OFFLINE_CATALOG_SHAPE)).toEqual({
        missing: [],
        unexpected: [],
    });
    for (const p of catalogue.body.products)
        expect(wireShapeDiff(p, OFFLINE_PRODUCT_SHAPE)).toEqual({
            missing: [],
            unexpected: [],
        });
    let item = catalogue.body.products.find((p) => p._id === product);
    let next = catalogue.body.next;
    while (!item && next) {
        const page: { status: number; body: OfflineCatalogPage } =
            await read<OfflineCatalogPage>(
                await db.call(
                    seller,
                    'GET',
                    `/offline/catalog?lease=${lease._id}&after=${encodeURIComponent(next)}`,
                ),
            );
        expect(page.status).toBe(200);
        item = page.body.products.find((p) => p._id === product);
        next = page.body.next;
    }
    if (!item)
        throw new Error('Fixture product absent from complete catalogue');
    body = {
        lease: lease._id,
        idempotencyKey: randomUUID(),
        soldAt: new Date().toISOString(),
        amountTendered: 10000,
        lines: [{ product, quantity: 450, proof: item.proof }],
    };
});
it('preserves signed cached price after an online price edit, original time and exact weighed stock', async () => {
    await db
        .model('Product')
        .updateOne({ _id: product }, { $set: { price: 25000 } });
    const result = await read<Receipt>(
        await db.call(seller, 'POST', '/offline/sync', body),
    );
    expect(result.status).toBe(201);
    expect(wireShapeDiff(result.body, RECEIPT_SHAPE)).toEqual({
        missing: [],
        unexpected: [],
    });
    expect(result.body.totalAmount).toBe(8100);
    expect(result.body.changeGiven).toBe(1900);
    expect(result.body.createdAt).toBe(body.soldAt);
    expect(await stockOf(db, product)).toBe(0);
    const stored = await db
        .model<Sales>('Sales')
        .findById(result.body._id)
        .lean();
    expect(stored?.soldAt?.toISOString()).toBe(body.soldAt);
    expect(stored?.offline).toBe(true);
});

it('preserves the server lease identity for delayed uploads after store identity changes', async () => {
    expect(lease.storeIdentity?.storeName).toBeTruthy();
    await db
        .model('Settings')
        .updateOne(
            { key: 'store' },
            { $set: { storeName: 'Changed after lease' } },
        );
    const result = await read<Receipt>(
        await db.call(seller, 'POST', '/offline/sync', body),
    );
    expect(result.status).toBe(201);
    expect(result.body.storeIdentity).toEqual(lease.storeIdentity);
    const replay = await read<Receipt>(
        await db.call(seller, 'POST', '/offline/sync', body),
    );
    expect(replay.body.storeIdentity).toEqual(lease.storeIdentity);
});
it('replays lost-response and simultaneous uploads exactly once', async () => {
    const results = await Promise.all(
        [1, 2, 3].map(() =>
            db
                .call(seller, 'POST', '/offline/sync', body)
                .then((r) => read<Receipt>(r)),
        ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(results.map((r) => r.body._id)).size).toBe(1);
    expect(await stockOf(db, product)).toBe(0);
    const replay = await read<Receipt>(
        await db.call(seller, 'POST', '/offline/sync', body),
    );
    expect(replay.body).toEqual(results[0].body);
    const movements = await db
        .model<StockMovement>('StockMovement')
        .find({ product })
        .sort({ sequence: 1 })
        .lean();
    expect(
        movements.map((row) => [row.type, row.quantity, row.balanceAfter]),
    ).toEqual([
        ['OPENING', 450, 450],
        ['SALE', -450, 0],
    ]);
    expect(String(movements[1].refId)).toBe(replay.body._id);
    expect(movements[1].occurredAt.toISOString()).toBe(body.soldAt);
    expect(movements[1].createdAt.getTime()).toBeGreaterThanOrEqual(
        new Date(body.soldAt).getTime(),
    );
    expect(movements[1].unit).toBe(UnitOfMeasure.KG);
    expect(movements.reduce((sum, row) => sum + row.quantity, 0)).toBe(
        await stockOf(db, product),
    );
});
it('records completed cash despite an oversell and keeps normal online oversell guarded', async () => {
    body.lines[0].quantity = 900;
    body.amountTendered = 16200;
    const result = await read<Receipt>(
        await db.call(seller, 'POST', '/offline/sync', body),
    );
    expect(result.status).toBe(201);
    expect(await stockOf(db, product)).toBe(-450);
    const sale = await db
        .model<Sales>('Sales')
        .findById(result.body._id)
        .lean();
    expect(sale?.stockShortfall).toBe(true);
    const movements = await db
        .model<StockMovement>('StockMovement')
        .find({ product })
        .sort({ sequence: 1 })
        .lean();
    expect(
        movements.map((row) => [row.type, row.quantity, row.balanceAfter]),
    ).toEqual([
        ['OPENING', 450, 450],
        ['SALE', -900, -450],
    ]);
    expect(String(movements[1].refId)).toBe(result.body._id);
    expect(movements.reduce((sum, row) => sum + row.quantity, 0)).toBe(-450);
    const online = await db.call(seller, 'POST', '/sales', {
        paymentType: 'CASH',
        idempotencyKey: randomUUID(),
        tenders: [{ type: 'CASH', amount: 8100 }],
        sellDetails: [{ product, quantity: 450 }],
    });
    expect(online.status).toBe(400);
    expect(await stockOf(db, product)).toBe(-450);
});
it('blocks own close while a terminal lease is active and permits close after sync/release', async () => {
    const blocked = await read<AppErrorResponse>(
        await db.call(seller, 'POST', '/shifts/current/close', { counts: {} }),
    );
    expect(blocked.body.error).toBe(ErrorCode.OFFLINE_PENDING);
    expect(blocked.body.message).toMatch(/ask an admin to force-close/);
    // A count only (#143): the one terminal holding a lease, no ids.
    expect(blocked.body.details).toEqual({ terminals: 1 });
    expect(
        wireShapeDiff(blocked.body.details, OFFLINE_PENDING_DETAILS_SHAPE),
    ).toEqual({ missing: [], unexpected: [] });
    expect((await db.call(seller, 'POST', '/offline/sync', body)).status).toBe(
        201,
    );
    expect(
        (
            await db.call(
                seller,
                'POST',
                `/offline/leases/${lease._id}/release`,
                { terminalId },
            )
        ).status,
    ).toBe(201);
    const closed = await read<{ tenders: { cash: number } }>(
        await db.call(seller, 'POST', '/shifts/current/close', { counts: {} }),
    );
    expect(closed.status).toBe(201);
    expect(closed.body.tenders.cash).toBe(8100);
});
it('cannot release another terminal lease', async () => {
    const response = await db.call(
        seller,
        'POST',
        `/offline/leases/${lease._id}/release`,
        { terminalId: randomUUID() },
    );
    expect(response.status).toBe(409);
});
it('requires admin reconciliation after force close and keeps the original Z-read unchanged', async () => {
    expect(
        (
            await db.call(admin, 'POST', `/shifts/${lease.shift._id}/close`, {
                counts: {},
            })
        ).status,
    ).toBe(201);
    const original = await db
        .model<Shift>('Shift')
        .findById(lease.shift._id)
        .lean();
    const blocked = await read<AppErrorResponse>(
        await db.call(seller, 'POST', '/offline/sync', body),
    );
    expect(blocked.body.error).toBe(ErrorCode.OFFLINE_RECONCILIATION_REQUIRED);
    const accepted = await read<Receipt>(
        await db.call(admin, 'POST', '/offline/reconcile', {
            ...body,
            reason: 'Cash counted after reconnect',
        }),
    );
    expect(accepted.status).toBe(201);
    const after = await db
        .model<Shift>('Shift')
        .findById(lease.shift._id)
        .lean();
    expect(after?.zRead).toEqual(original?.zRead);
    const detail = await read<{
        report: { offlineAddendum: { count: number; netCash: number } };
    }>(await db.call(admin, 'GET', `/shifts/${lease.shift._id}`));
    expect(detail.body.report.offlineAddendum).toEqual({
        count: 1,
        netCash: 8100,
    });
});
it('requires reconciliation after cashier deactivation or session revocation', async () => {
    await db
        .model<User>('User')
        .updateOne({ _id: seller.userId }, { $set: { isActive: false } });
    expect((await db.call(seller, 'POST', '/offline/sync', body)).status).toBe(
        409,
    );
    expect(
        (
            await db.call(admin, 'POST', '/offline/reconcile', {
                ...body,
                reason: 'Cash verified from inactive cashier',
            })
        ).status,
    ).toBe(201);
});
it('rejects a fabricated proof, wrong owner, changed product and invalid timestamp without stock writes', async () => {
    expect(
        (
            await db.call(seller, 'POST', '/offline/sync', {
                ...body,
                lines: [{ ...body.lines[0], proof: body.lines[0].proof + 'x' }],
            })
        ).status,
    ).toBe(409);
    const other = caller('other', Role.Seller);
    expect((await db.call(other, 'POST', '/offline/sync', body)).status).toBe(
        409,
    );
    expect(
        (
            await db.call(seller, 'POST', '/offline/sync', {
                ...body,
                soldAt: '2099-01-01T00:00:00.000Z',
            })
        ).status,
    ).toBe(409);
    expect(
        (
            await db.call(seller, 'POST', '/offline/sync', {
                ...body,
                lines: [
                    {
                        ...body.lines[0],
                        product: new Types.ObjectId().toString(),
                    },
                ],
            })
        ).status,
    ).toBe(409);
    expect(await stockOf(db, product)).toBe(450);
});
it('rejects online-only fields, insufficient tender and duplicate lines', async () => {
    expect(
        (
            await db.call(seller, 'POST', '/offline/sync', {
                ...body,
                discount: { type: 'FIXED', value: 100, reason: 'not allowed' },
            })
        ).status,
    ).toBe(400);
    expect(
        (
            await db.call(seller, 'POST', '/offline/sync', {
                ...body,
                amountTendered: 1,
            })
        ).status,
    ).toBe(400);
    expect(
        (
            await db.call(seller, 'POST', '/offline/sync', {
                ...body,
                lines: [body.lines[0], body.lines[0]],
            })
        ).status,
    ).toBe(409);
});
it('accepts the full bounded signed-line batch without relaxing ordinary request limits', async () => {
    const docs = Array.from({ length: 200 }, () => productDocs(1, 1));
    await db.model('Product').insertMany(docs.map((d) => d.product));
    await db.model('Inventory').insertMany(docs.map((d) => d.inventory));
    const ids = new Set(docs.map((d) => String(d.product._id)));
    let after: string | null = null;
    const prices = [] as OfflineCatalogPage['products'];
    do {
        const page: { status: number; body: OfflineCatalogPage } =
            await read<OfflineCatalogPage>(
                await db.call(
                    seller,
                    'GET',
                    `/offline/catalog?lease=${lease._id}${after ? `&after=${encodeURIComponent(after)}` : ''}`,
                ),
            );
        expect(page.status).toBe(200);
        prices.push(...page.body.products.filter((p) => ids.has(p._id)));
        after = page.body.next;
    } while (after);
    const request = {
        ...body,
        soldAt: new Date().toISOString(),
        amountTendered: 200,
        lines: prices.map((p) => ({
            product: p._id,
            quantity: 1,
            proof: p.proof,
        })),
    };
    expect(request.lines).toHaveLength(200);
    expect(Buffer.byteLength(JSON.stringify(request))).toBeGreaterThan(
        100 * 1024,
    );
    expect(
        (await db.call(seller, 'POST', '/offline/sync', request)).status,
    ).toBe(201);
    expect(
        (
            await db.call(seller, 'POST', '/offline/sync', {
                ...request,
                oversized: 'x'.repeat(256 * 1024),
            })
        ).status,
    ).toBe(413);
    expect(
        (
            await db.call(seller, 'POST', '/sales', {
                oversized: 'x'.repeat(110 * 1024),
            })
        ).status,
    ).toBe(413);
});

it('recovers simultaneous or lost lease responses using the same durable terminal identity', async () => {
    const responses = await Promise.all(
        [1, 2].map(() =>
            db
                .call(seller, 'POST', '/offline/lease', { terminalId })
                .then((r) => read<OfflineLeaseView>(r)),
        ),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses.map((r) => r.body._id)).toEqual([lease._id, lease._id]);
    expect(
        await db
            .model<OfflineLease>('OfflineLease')
            .countDocuments({ cashier: seller.userId, active: true }),
    ).toBe(1);
    expect(
        (
            await db.call(
                seller,
                'POST',
                `/offline/leases/${lease._id}/release`,
                { terminalId },
            )
        ).status,
    ).toBe(201);
    expect(
        await db
            .model<OfflineLease>('OfflineLease')
            .countDocuments({ cashier: seller.userId, active: true }),
    ).toBe(0);
});
it('lets admins reconcile signed historical barcodes after a correction without remapping products', async () => {
    await db
        .model<Product>('Product')
        .updateOne({ _id: product }, { $set: { EAN: '012345678905' } });
    expect((await db.call(seller, 'POST', '/offline/sync', body)).status).toBe(
        409,
    );
    expect(await stockOf(db, product)).toBe(450);
    const changedProduct = {
        ...body,
        lines: body.lines.map((line) => ({
            ...line,
            product: String(new Types.ObjectId()),
        })),
    };
    expect(
        (
            await db.call(admin, 'POST', '/offline/reconcile', {
                ...changedProduct,
                reason: 'Barcode corrected',
            })
        ).status,
    ).toBe(409);
    const reconciled = await read<Receipt>(
        await db.call(admin, 'POST', '/offline/reconcile', {
            ...body,
            reason: 'Barcode corrected after cash sale',
        }),
    );
    expect(reconciled.status).toBe(201);
    expect(reconciled.body.totalAmount).toBe(8100);
    expect(await stockOf(db, product)).toBe(0);
    const replay = await read<Receipt>(
        await db.call(admin, 'POST', '/offline/reconcile', {
            ...body,
            reason: 'Barcode corrected after cash sale',
        }),
    );
    expect(replay.body._id).toBe(reconciled.body._id);
    expect(await stockOf(db, product)).toBe(0);
    expect(
        await db
            .model<Sales>('Sales')
            .countDocuments({ idempotencyKey: body.idempotencyKey }),
    ).toBe(1);
    const recorded = await db
        .model<Sales>('Sales')
        .findById(reconciled.body._id)
        .lean();
    expect(String(recorded?.reconciledBy)).toBe(admin.userId);
    expect(recorded?.reconciliationReason).toBe(
        'Barcode corrected after cash sale',
    );
});
it('sends archived product tombstones without new proofs and accepts already-collected cash', async () => {
    expect(
        (
            await db.call(admin, 'PATCH', '/products', {
                updates: [{ product, update: { isActive: false } }],
            })
        ).status,
    ).toBe(200);
    let after: string | null = null;
    let archived: import('@grocery-pos/contracts').OfflineProduct | undefined;
    do {
        const page: { status: number; body: OfflineCatalogPage } =
            await read<OfflineCatalogPage>(
                await db.call(
                    seller,
                    'GET',
                    `/offline/catalog?lease=${lease._id}${after ? `&after=${encodeURIComponent(after)}` : ''}`,
                ),
            );
        expect(page.status).toBe(200);
        archived ??= page.body.products.find((p) => p._id === product);
        after = page.body.next;
    } while (after);
    expect(archived).toMatchObject({ isActive: false, proof: '' });
    const result = await read<Receipt>(
        await db.call(seller, 'POST', '/offline/sync', body),
    );
    expect(result.status).toBe(201);
    expect(result.body.totalAmount).toBe(8100);
    expect(await stockOf(db, product)).toBe(0);
});
