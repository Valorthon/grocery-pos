import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
    AuditAction,
    Role,
    ShiftStatus,
    UnitOfMeasure,
    STORE_SETTINGS_SHAPE,
    receiptStoreIdentity,
    wireShapeDiff,
    type StoreSettings,
    type Receipt,
    type ZReadReport,
} from '@grocery-pos/contracts';
import {
    bootDbApp,
    caller,
    read,
    openShift,
    seedProduct,
    cashSale,
    type DbApp,
} from './db-app';
import { SettingsService } from '../../src/settings/settings.service';
let db: DbApp;
const admin = caller('settings-admin', Role.Admin);
beforeAll(async () => {
    db = await bootDbApp();
});
afterAll(async () => {
    await db?.close();
});
beforeEach(async () => {
    await db
        .model('Shift')
        .updateMany({}, { $set: { status: ShiftStatus.CLOSED } });
    await db.model('OfflineLease').updateMany({}, { $set: { active: false } });
});
async function current() {
    const result = await read<StoreSettings>(
        await db.call(admin, 'GET', '/settings'),
    );
    expect(result.status).toBe(200);
    return result.body;
}
async function patch(values: Record<string, unknown>) {
    return read<StoreSettings>(
        await db.call(admin, 'PATCH', '/settings', {
            version: (await current()).version,
            ...values,
        }),
    );
}
it('returns one initialized PHP singleton to all authenticated roles and restricts edits to admin', async () => {
    const rows = await Promise.all(Array.from({ length: 8 }, () => current()));
    expect(rows.every((row) => row.currency === 'PHP')).toBe(true);
    expect(await db.model('Settings').countDocuments({ key: 'store' })).toBe(1);
    expect(wireShapeDiff(rows[0], STORE_SETTINGS_SHAPE)).toEqual({
        missing: [],
        unexpected: [],
    });
    for (const role of [
        Role.Seller,
        Role.Restocker,
        Role.Adjuster,
        Role.UserManager,
        Role.Supervisor,
    ]) {
        const who = caller(role.toLowerCase(), role);
        expect((await db.call(who, 'GET', '/settings')).status).toBe(200);
        expect(
            (
                await db.call(who, 'PATCH', '/settings', {
                    version: rows[0].version,
                    storeName: 'forbidden',
                })
            ).status,
        ).toBe(403);
    }
});
it('audits the committed whitelisted settings update and keeps PHP and discount policy fixed', async () => {
    const result = await patch({
        storeName: ' Fresh & Local ',
        receiptFooter: ' Thank you! ',
        defaultReorderLevel: 4,
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
        storeName: 'Fresh & Local',
        receiptFooter: 'Thank you!',
        currency: 'PHP',
        defaultReorderLevel: 4,
    });
    const entries = await db
        .model<{ action: string; after: { storeName: string } }>('AuditLog')
        .find({ action: AuditAction.SETTINGS_UPDATED })
        .lean();
    expect(entries).toHaveLength(1);
    expect(entries[0].after.storeName).toBe('Fresh & Local');
    expect((await patch({ currency: 'USD' })).status).toBe(400);
    expect((await patch({ discountApprovalThreshold: 100 })).status).toBe(400);
    expect((await patch({ timezone: 'Asia/Atlantis' })).status).toBe(400);
    expect((await patch({ storeName: null })).status).toBe(400);
});
it('serializes competing updates with optimistic versions', async () => {
    const { version } = await current();
    const responses = await Promise.all(
        ['One', 'Two'].map((storeName) =>
            db.call(admin, 'PATCH', '/settings', { version, storeName }),
        ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await current()).version).toBe(version + 1);
});
it('rolls back settings if audit recording fails', async () => {
    const before = await current();
    const audit = db.model('AuditLog');
    const mocked = jest
        .spyOn(audit, 'create')
        .mockRejectedValueOnce(new Error('audit write failed'));
    try {
        expect((await patch({ storeName: 'Never committed' })).status).toBe(
            500,
        );
    } finally {
        mocked.mockRestore();
    }
    expect(await current()).toEqual(before);
});
it('rejects timezone changes while any shift is open but permits identity edits', async () => {
    const who = caller('settings-shift', Role.Seller);
    await openShift(db, who);
    const before = await current();
    const nextZone = before.timezone === 'UTC' ? 'Asia/Manila' : 'UTC';
    expect((await patch({ timezone: nextZone })).status).toBe(409);
    expect(
        (await patch({ branchName: 'Open shift identity edit' })).status,
    ).toBe(200);
    expect((await current()).timezone).toBe(before.timezone);
});
it('rejects timezone changes while any offline lease remains active, even after force-close', async () => {
    await db.model('OfflineLease').create({
        cashier: new Types.ObjectId(),
        shift: new Types.ObjectId(),
        sid: randomUUID(),
        terminalId: randomUUID(),
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        active: true,
    });
    const before = await current();
    expect(
        (
            await patch({
                timezone: before.timezone === 'UTC' ? 'Asia/Manila' : 'UTC',
            })
        ).status,
    ).toBe(409);
    expect((await current()).timezone).toBe(before.timezone);
});
it('serializes timezone edits with concurrent shift creation', async () => {
    const who = caller('settings-racing', Role.Seller);
    const before = await current();
    const responses = await Promise.all([
        db.call(admin, 'PATCH', '/settings', {
            version: before.version,
            timezone: before.timezone === 'UTC' ? 'Asia/Manila' : 'UTC',
        }),
        db.call(who, 'POST', '/shifts', {
            counts: { '100': 1 },
            terminal: ' Lane 9 ',
        }),
    ]);
    expect(responses[1].status).toBe(201);
    expect([200, 409]).toContain(responses[0].status);
    const shift = await db
        .model<{ storeSettings: StoreSettings; terminal: string }>('Shift')
        .findOne({ cashier: who.userId })
        .lean();
    expect(shift?.storeSettings.timezone).toBe((await current()).timezone);
    expect(shift?.terminal).toBe('Lane 9');
});
it('reads committed timezone across API consumers without process-local settings cache', async () => {
    expect((await patch({ timezone: 'America/Los_Angeles' })).status).toBe(200);
    const options = await read<{ timeZone: string }>(
        await db.call(admin, 'GET', '/reports/options'),
    );
    expect(options.body.timeZone).toBe('America/Los_Angeles');
    await db
        .model('Settings')
        .updateOne(
            { key: 'store' },
            { $set: { timezone: 'Pacific/Auckland' } },
        );
    expect(
        (
            await read<{ timeZone: string }>(
                await db.call(admin, 'GET', '/reports/options'),
            )
        ).body.timeZone,
    ).toBe('Pacific/Auckland');
    expect(await db.app.get(SettingsService).timezone()).toBe(
        'Pacific/Auckland',
    );
});
it('uses the new-product reorder default without altering explicit or legacy existing levels', async () => {
    await patch({ defaultReorderLevel: 7 });
    const old = await seedProduct(db, 100, 10);
    const suffix = randomUUID().slice(0, 8);
    const response = await db.call(admin, 'POST', '/products/bulk', {
        newProducts: [
            { name: `Default pieces ${suffix}`, price: 100 },
            {
                name: `Default kg ${suffix}`,
                price: 100,
                unit: UnitOfMeasure.KG,
            },
        ],
    });
    expect(response.status).toBe(201);
    const rows = await db
        .model<{ name: string; reorderLevel?: number; unit?: string }>(
            'Product',
        )
        .find({ name: { $regex: suffix } })
        .lean();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.unit === UnitOfMeasure.KG)?.reorderLevel).toBe(
        7000,
    );
    expect(rows.find((r) => r.unit !== UnitOfMeasure.KG)?.reorderLevel).toBe(7);
    expect(
        (
            await db
                .model<{ reorderLevel?: number }>('Product')
                .findById(old)
                .lean()
        )?.reorderLevel,
    ).not.toBe(7);
});
it('captures receipt identity per sale and preserves it across settings changes and replay', async () => {
    const who = caller('settings-receipt', Role.Seller);
    await db.call(who, 'POST', '/shifts', {
        counts: { '100': 1 },
        terminal: 'Lane Snapshot',
    });
    const product = await seedProduct(db, 100, 4);
    await patch({ storeName: 'Original Store' });
    const body = cashSale(product, 1, 100);
    const sale = await read<Receipt>(
        await db.call(who, 'POST', '/sales', body),
    );
    expect(sale.status).toBe(201);
    expect(sale.body.storeIdentity).toMatchObject({
        storeName: 'Original Store',
        terminalLabel: 'Lane Snapshot',
        currency: 'PHP',
    });
    await patch({ storeName: 'Renamed Store' });
    const replay = await read<Receipt>(
        await db.call(who, 'POST', '/sales', body),
    );
    expect(replay.body.storeIdentity).toEqual(sale.body.storeIdentity);
    const next = await read<Receipt>(
        await db.call(who, 'POST', '/sales', cashSale(product, 1, 100)),
    );
    expect(next.body.storeIdentity?.storeName).toBe('Renamed Store');
    const closed = await read<ZReadReport>(
        await db.call(who, 'POST', '/shifts/current/close', {
            counts: { '100': 1 },
        }),
    );
    expect(closed.status).toBe(201);
    expect(closed.body.storeIdentity?.storeName).toBe('Renamed Store');
    await patch({ storeName: 'Even Later' });
    expect(
        (
            await db
                .model<{ zRead: ZReadReport }>('Shift')
                .findById(closed.body.shiftId)
                .lean()
        )?.zRead.storeIdentity,
    ).toEqual(closed.body.storeIdentity);
    expect(receiptStoreIdentity(await current(), 'X').storeName).toBe(
        'Even Later',
    );
});
