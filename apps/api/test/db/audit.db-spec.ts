import * as argon from 'argon2';
import { Types } from 'mongoose';
import {
    AuditAction,
    AUDIT_LOG_SHAPE,
    Role,
    DiscountType,
    OverrideAction,
    wireShapeDiff,
    type AuditLogView,
    type Paginated,
} from '@grocery-pos/contracts';
import {
    bootDbApp,
    caller,
    cashSale,
    openShift,
    seedProduct,
    read,
    type DbApp,
} from './db-app';
import { discountApprovalHeaders, approvalHeaders } from './approval-fixtures';
import { AuditService } from '../../src/audit/audit.service';
import { AuditLog } from '../../src/audit/audit.schema';

let db: DbApp;
const admin = caller('audit-admin', Role.Admin),
    seller = caller('audit-seller', Role.Seller),
    manager = caller('audit-user-manager', Role.UserManager);
beforeAll(async () => {
    db = await bootDbApp();
    for (const who of [admin, seller, manager])
        await db.model('User').create({
            _id: new Types.ObjectId(who.userId),
            name: who.username,
            roles: who.roles,
            isActive: true,
            passwordHash: await argon.hash('password-audit-123'),
        });
});
afterAll(async () => {
    await db?.close();
});
const events = (action: AuditAction, targetId?: string) =>
    db
        .model<AuditLog>('AuditLog')
        .find({
            action,
            ...(targetId ? { targetId: new Types.ObjectId(targetId) } : {}),
        })
        .sort({ createdAt: 1, _id: 1 })
        .lean();
it('records bounded request metadata, exact user actions and secret-free business fields', async () => {
    const response = await db.call(
        admin,
        'POST',
        '/users',
        {
            users: [
                {
                    name: 'audit-created',
                    roles: [Role.Seller],
                    password: 'never-log-this-password',
                },
            ],
        },
        { 'user-agent': 'x'.repeat(800) },
    );
    expect(response.status).toBe(201);
    const [created] = await events(AuditAction.USER_CREATED);
    expect(created).toMatchObject({
        actorName: admin.username,
        after: { name: 'audit-created', roles: [Role.Seller] },
    });
    expect(created.userAgent).toHaveLength(512);
    expect(created.ip).toBe('127.0.0.1');
    const target = String(created.targetId);
    expect(
        (
            await db.call(admin, 'PATCH', '/users', {
                updates: [
                    {
                        user: target,
                        update: {
                            roles: [Role.Adjuster],
                            isActive: false,
                            password: 'do-not-log-this-either',
                        },
                    },
                ],
            })
        ).status,
    ).toBe(200);
    for (const action of [
        AuditAction.USER_ROLE_CHANGED,
        AuditAction.USER_DEACTIVATED,
        AuditAction.USER_PASSWORD_RESET,
    ])
        expect(await events(action, target)).toHaveLength(1);
    const raw = JSON.stringify(await db.model('AuditLog').find().lean());
    for (const secret of [
        'never-log-this-password',
        'do-not-log-this-either',
        'passwordHash',
        'overridePinHash',
        '$argon2',
    ])
        expect(raw).not.toContain(secret);
});
it('keeps state and audit atomic on audit insertion failure', async () => {
    const product = await seedProduct(db, 100, 4);
    const old = await db
        .model<{ price: number }>('Product')
        .findById(product)
        .lean();
    const spy = jest
        .spyOn(db.app.get(AuditService), 'record')
        .mockRejectedValueOnce(new Error('forced audit outage'));
    const response = await db.call(admin, 'PATCH', '/products', {
        updates: [{ product: String(product), update: { price: 200 } }],
    });
    spy.mockRestore();
    expect(response.status).toBe(500);
    expect(
        (await db.model<{ price: number }>('Product').findById(product).lean())!
            .price,
    ).toBe(old!.price);
    expect(
        await events(AuditAction.PRODUCT_PRICE_CHANGED, String(product)),
    ).toHaveLength(0);
    expect(
        (
            await db.call(admin, 'PATCH', '/products', {
                updates: [{ product: String(product), update: { price: 200 } }],
            })
        ).status,
    ).toBe(200);
    expect(
        await events(AuditAction.PRODUCT_PRICE_CHANGED, String(product)),
    ).toHaveLength(1);
});
it('records one discount on replay and one reversal with manager identity', async () => {
    await openShift(db, seller);
    const product = await seedProduct(db, 1000, 10);
    const request = {
        ...cashSale(product, 1, 1000),
        discount: {
            type: DiscountType.FIXED,
            value: 100,
            reason: 'audit discount',
        },
    };
    const headers = await discountApprovalHeaders(db, seller, request);
    const sale = await read<{ _id: string }>(
        await db.call(seller, 'POST', '/sales', request, headers),
    );
    expect(sale.status).toBe(201);
    expect(
        (await db.call(seller, 'POST', '/sales', request, headers)).status,
    ).toBe(201);
    const discounted = await events(AuditAction.SALE_DISCOUNTED, sale.body._id);
    expect(discounted).toHaveLength(1);
    expect(discounted[0].approvedBy).toBeTruthy();
    const reversalHeaders = await approvalHeaders(
        db,
        admin,
        OverrideAction.VOID,
        { reversal: { saleId: sale.body._id, reason: 'audit void' } },
    );
    expect(
        (
            await db.call(
                admin,
                'POST',
                `/sales/${sale.body._id}/void`,
                { reason: 'audit void' },
                reversalHeaders,
            )
        ).status,
    ).toBe(201);
    const reversed = await events(AuditAction.SALE_VOIDED, sale.body._id);
    expect(reversed).toHaveLength(1);
    expect(reversed[0].actorName).toBe(admin.username);
    expect(reversed[0].approvedBy).toBeTruthy();
});
it('audits shift drawer and close operations once in their transactions', async () => {
    const who = caller('audit-drawer', Role.Seller);
    await openShift(db, who);
    expect(await events(AuditAction.SHIFT_OPENED)).not.toHaveLength(0);
    expect(
        (
            await db.call(who, 'POST', '/shifts/current/drawer', {
                type: 'CASH_IN',
                amount: 100,
                reason: 'audit in',
            })
        ).status,
    ).toBe(201);
    expect(
        (
            await db.call(who, 'POST', '/shifts/current/drawer', {
                type: 'CASH_DROP',
                amount: 50,
                reason: 'audit drop',
            })
        ).status,
    ).toBe(201);
    expect(await events(AuditAction.SHIFT_CASH_IN)).toHaveLength(1);
    expect(await events(AuditAction.SHIFT_CASH_DROPPED)).toHaveLength(1);
    expect(
        (
            await db.call(who, 'POST', '/shifts/current/close', {
                counts: { '100': 1 },
            })
        ).status,
    ).toBe(201);
    expect(await events(AuditAction.SHIFT_CLOSED)).toHaveLength(1);
});
it('audits generic failed and successful login without persisting credentials or tokens', async () => {
    expect(
        (
            await db.call(admin, 'POST', '/auth/login', {
                username: 'audit-unknown',
                password: 'bad-password-secret',
            })
        ).status,
    ).toBe(401);
    expect(
        (
            await db.call(admin, 'POST', '/auth/login', {
                username: admin.username,
                password: 'password-audit-123',
            })
        ).status,
    ).toBe(201);
    expect(await events(AuditAction.AUTH_LOGIN_FAILED)).toHaveLength(1);
    expect((await events(AuditAction.AUTH_LOGIN_FAILED))[0]).toMatchObject({
        actor: null,
        after: { name: 'audit-unknown' },
    });
    const success = await events(AuditAction.AUTH_LOGIN);
    expect(success).toHaveLength(1);
    const raw = JSON.stringify([
        ...success,
        ...(await events(AuditAction.AUTH_LOGIN_FAILED)),
    ]);
    for (const text of [
        'password-audit-123',
        'bad-password-secret',
        'refreshId',
        'jwtPayload',
    ])
        expect(raw).not.toContain(text);
});
it('restricts list access to admins and validates filter/pagination/wire shape', async () => {
    for (const who of [seller, manager])
        expect((await db.call(who, 'GET', '/audit')).status).toBe(403);
    const result = await read<Paginated<AuditLogView>>(
        await db.call(
            admin,
            'GET',
            `/audit?username=${encodeURIComponent(` ${admin.username.toUpperCase()} `)}&action=${AuditAction.AUTH_LOGIN}&page=1&limit=1`,
        ),
    );
    expect(result.status).toBe(200);
    expect(result.body.totalItems).toBe(1);
    expect(wireShapeDiff(result.body.data[0], AUDIT_LOG_SHAPE)).toEqual({
        missing: [],
        unexpected: [],
    });
    expect(result.body.data[0].actor).toMatchObject({
        _id: admin.userId,
        name: admin.username,
    });
    const unknown = await read<Paginated<AuditLogView>>(
        await db.call(admin, 'GET', '/audit?username=audit-nobody'),
    );
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual({ totalItems: 0, data: [] });
    expect(
        (await db.call(admin, 'GET', `/audit?actor=${admin.userId}`)).status,
    ).toBe(400);
    expect((await db.call(admin, 'GET', '/audit?limit=101')).status).toBe(400);
    expect(
        (await db.call(admin, 'GET', '/audit?from=2026-12-02&to=2026-12-01'))
            .status,
    ).toBe(400);
    expect((await db.call(admin, 'GET', '/audit?action=INVALID')).status).toBe(
        400,
    );
});
it('blocks application update/delete/save/bulk mutations and defines no TTL index', async () => {
    const model = db.model<AuditLog>('AuditLog');
    const row = await model.findOne().orFail();
    for (const operation of [
        () =>
            model.updateOne(
                { _id: row._id },
                { $set: { actorName: 'changed' } },
            ),
        () => model.updateMany({}, { $set: { actorName: 'changed' } }),
        () =>
            model.findOneAndUpdate(
                { _id: row._id },
                { $set: { actorName: 'changed' } },
            ),
        () =>
            model.replaceOne(
                { _id: row._id },
                { ...row.toObject(), actorName: 'changed' },
            ),
        () => model.deleteOne({ _id: row._id }),
        () => model.deleteMany({}),
        () => model.findOneAndDelete({ _id: row._id }),
        () => model.bulkWrite([{ deleteOne: { filter: { _id: row._id } } }]),
    ])
        await expect(operation()).rejects.toThrow('append-only');
    row.actorName = 'changed';
    await expect(row.save()).rejects.toThrow('append-only');
    await expect(row.deleteOne()).rejects.toThrow('append-only');
    expect(
        (await model.collection.indexes()).some(
            (index) => index.expireAfterSeconds !== undefined,
        ),
    ).toBe(false);
});

it('records safe PIN setup/removal and self-password change without secret material', async () => {
    expect(
        (
            await db.call(
                admin,
                'PATCH',
                `/users/${admin.userId}/override-pin`,
                { pin: '123456' },
            )
        ).status,
    ).toBe(200);
    expect(
        (
            await db.call(
                admin,
                'PATCH',
                `/users/${admin.userId}/override-pin`,
                { pin: null },
            )
        ).status,
    ).toBe(200);
    const changes = await events(AuditAction.USER_PIN_CHANGED, admin.userId);
    expect(changes).toHaveLength(2);
    expect(changes.map((row) => row.after)).toEqual([
        { pinConfigured: true },
        { pinConfigured: false },
    ]);
    expect(
        (
            await db.call(admin, 'PATCH', '/users/me/password', {
                currentPassword: 'password-audit-123',
                newPassword: 'new-private-password',
            })
        ).status,
    ).toBe(200);
    expect(
        await events(AuditAction.USER_PASSWORD_CHANGED, admin.userId),
    ).toHaveLength(1);
    const raw = JSON.stringify(await db.model('AuditLog').find().lean());
    expect(raw).not.toContain('123456');
    expect(raw).not.toContain('new-private-password');
});
it('distinguishes explicit admin force-close from cashier self-close even for the same user', async () => {
    const who = caller('audit-admin-cashier', Role.Admin, Role.Seller);
    const shift = await openShift(db, who);
    expect(
        (
            await db.call(who, 'POST', `/shifts/${shift}/close`, {
                counts: { '1000': 1 },
            })
        ).status,
    ).toBe(201);
    expect(await events(AuditAction.SHIFT_FORCE_CLOSED, shift)).toHaveLength(1);
    expect(await events(AuditAction.SHIFT_CLOSED, shift)).toHaveLength(0);
});
it('rolls back a drawer change if its audit cannot be recorded', async () => {
    const who = caller('audit-drawer-rollback', Role.Seller);
    const shift = await openShift(db, who);
    const spy = jest
        .spyOn(db.app.get(AuditService), 'record')
        .mockRejectedValueOnce(new Error('audit unavailable'));
    const response = await db.call(who, 'POST', '/shifts/current/drawer', {
        type: 'CASH_IN',
        amount: 100,
        reason: 'not committed',
    });
    spy.mockRestore();
    expect(response.status).toBe(500);
    const row = await db
        .model<{ movements: unknown[] }>('Shift')
        .findById(shift)
        .lean();
    expect(row!.movements).toHaveLength(0);
    expect(await events(AuditAction.SHIFT_CASH_IN, shift)).toHaveLength(0);
});
it('filters by inclusive store days without mutating existing events', async () => {
    await db.model('AuditLog').create({
        actor: new Types.ObjectId(admin.userId),
        actorName: 'admin',
        action: AuditAction.USER_UPDATED,
        targetModel: 'User',
        targetId: new Types.ObjectId(),
        before: {},
        after: { name: 'boundary' },
        createdAt: new Date('2026-01-01T16:00:00Z'),
    });
    const result = await read<Paginated<AuditLogView>>(
        await db.call(admin, 'GET', '/audit?from=2026-01-02&to=2026-01-02'),
    );
    expect(result.status).toBe(200);
    expect(result.body.totalItems).toBe(1);
    const previous = await read<Paginated<AuditLogView>>(
        await db.call(admin, 'GET', '/audit?from=2026-01-01&to=2026-01-01'),
    );
    expect(previous.body.totalItems).toBe(0);
});

it('concurrent discounted checkout replays commit only one audit event', async () => {
    const product = await seedProduct(db, 1000, 5);
    const request = {
        ...cashSale(product, 1, 1000),
        discount: {
            type: DiscountType.FIXED,
            value: 100,
            reason: 'concurrent approved discount',
        },
    };
    const headers = await discountApprovalHeaders(db, seller, request);
    const responses = await Promise.all([
        db.call(seller, 'POST', '/sales', request, headers),
        db.call(seller, 'POST', '/sales', request, headers),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const receipts = await Promise.all(
        responses.map(
            (response) => response.json() as Promise<{ _id: string }>,
        ),
    );
    expect(receipts[0]._id).toBe(receipts[1]._id);
    expect(
        await events(AuditAction.SALE_DISCOUNTED, receipts[0]._id),
    ).toHaveLength(1);
});
it('concurrent same-price updates do not invent duplicate price-change audit entries', async () => {
    const product = await seedProduct(db, 500, 1);
    const body = { updates: [{ product, update: { price: 600 } }] };
    const responses = await Promise.all([
        db.call(admin, 'PATCH', '/products', body),
        db.call(admin, 'PATCH', '/products', body),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(
        await events(AuditAction.PRODUCT_PRICE_CHANGED, product),
    ).toHaveLength(1);
});
