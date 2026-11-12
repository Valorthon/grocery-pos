import { Types, type Model } from 'mongoose';
import { AuditAction } from '@grocery-pos/contracts';
import { AuditService } from './audit.service';
import { AuditLog } from './audit.schema';
import type { User } from '../user/user.schema';
import { AuditContextMiddleware, auditMetadata } from './audit-context';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import type { Request, Response } from 'express';

const id = new Types.ObjectId();
function setup(
    rows: Record<string, unknown>[] = [],
    found: { _id: Types.ObjectId } | null = null,
) {
    const query = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(rows),
    };
    const model = {
        init: jest.fn().mockResolvedValue(undefined),
        create: jest.fn().mockResolvedValue([]),
        find: jest.fn(() => query),
        countDocuments: jest.fn().mockResolvedValue(rows.length),
    };
    const userQuery = { lean: jest.fn().mockResolvedValue(found) };
    const users = {
        findOne: jest.fn(() => userQuery),
        find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })),
    };
    return {
        service: new AuditService(
            model as unknown as Model<AuditLog>,
            { get: () => 'Asia/Manila' } as unknown as TypedConfigService,
            users as unknown as Model<User>,
        ),
        model,
        query,
        users,
    };
}
it('awaits audit indexes and propagates startup failure', async () => {
    const { service, model } = setup();
    await service.onModuleInit();
    expect(model.init).toHaveBeenCalledTimes(1);
    model.init.mockRejectedValueOnce(new Error('index unavailable'));
    await expect(service.onModuleInit()).rejects.toThrow('index unavailable');
});
it('passes the supplied transaction and positively redacts business diffs', async () => {
    const { service, model } = setup();
    const session = {};
    await service.record(
        {
            actor: { userId: String(id), username: 'admin' },
            action: AuditAction.PRODUCT_PRICE_CHANGED,
            targetModel: 'Product',
            targetId: String(id),
            approvedBy: String(id),
            before: { price: 100, passwordHash: 'secret' },
            after: { price: 200, cookie: 'sid' },
        },
        session as never,
    );
    expect(model.create).toHaveBeenCalledWith(
        [
            expect.objectContaining({
                actor: id,
                actorName: 'admin',
                targetId: id,
                before: { price: 100 },
                after: { price: 200 },
                approvedBy: id,
                ip: null,
                userAgent: null,
            }),
        ],
        { session },
    );
});
it('records unknown actors and absent targets without fabricating attribution', async () => {
    const { service, model } = setup();
    await service.record({
        actor: null,
        action: AuditAction.AUTH_LOGIN_FAILED,
        targetModel: 'User',
    });
    expect(model.create).toHaveBeenCalledWith(
        [
            expect.objectContaining({
                actor: null,
                actorName: null,
                targetId: null,
                approvedBy: null,
                before: {},
                after: {},
            }),
        ],
        {},
    );
});
it('filters by actor/action/store-calendar days and returns whitelisted complete wire fields', async () => {
    const { service, model, query, users } = setup(
        [
            {
                _id: id,
                actor: id,
                actorName: 'Admin',
                targetModel: 'User',
                targetId: id,
                action: AuditAction.USER_UPDATED,
                before: { name: 'old', password: 'secret' },
                after: { name: 'new' },
                approvedBy: id,
                ip: '127.0.0.1',
                userAgent: 'browser',
                createdAt: new Date('2026-11-01T00:00:00Z'),
            },
        ],
        { _id: id },
    );
    const result = await service.list({
        page: 2,
        limit: 10,
        username: 'admin',
        action: AuditAction.USER_UPDATED,
        from: '2026-11-01',
        to: '2026-11-01',
    });
    expect(model.find).toHaveBeenCalledWith({
        $or: [
            { actor: id },
            { action: AuditAction.AUTH_LOGIN_FAILED, 'after.name': 'admin' },
        ],
        action: AuditAction.USER_UPDATED,
        createdAt: {
            $gte: new Date('2026-10-31T16:00:00Z'),
            $lt: new Date('2026-11-01T16:00:00Z'),
        },
    });
    expect(users.findOne).toHaveBeenCalledWith({ name: 'admin' }, { _id: 1 });
    expect(query.skip).toHaveBeenCalledWith(10);
    expect(query.limit).toHaveBeenCalledWith(10);
    expect(result.data[0]).toMatchObject({
        actor: { _id: String(id), name: 'Admin' },
        target: { model: 'User', id: String(id) },
        before: { name: 'old' },
        approvedBy: String(id),
        createdAt: '2026-11-01T00:00:00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
});
it('filters by the current holder of a username, so entries from before a rename still match (#143)', async () => {
    const { service, model, users } = setup(
        [
            {
                _id: id,
                actor: id,
                actorName: 'old-name',
                targetModel: 'User',
                action: AuditAction.AUTH_LOGIN,
                createdAt: new Date('2026-11-01T00:00:00Z'),
            },
        ],
        { _id: id },
    );
    const result = await service.list({
        page: 1,
        limit: 20,
        username: 'new-name',
    });
    expect(users.findOne).toHaveBeenCalledWith(
        { name: 'new-name' },
        { _id: 1 },
    );
    const filter = {
        $or: [
            { actor: id },
            {
                action: AuditAction.AUTH_LOGIN_FAILED,
                'after.name': 'new-name',
            },
        ],
    };
    expect(model.find).toHaveBeenCalledWith(filter);
    expect(model.countDocuments).toHaveBeenCalledWith(filter);
    expect(result.data[0].actor).toEqual({ _id: String(id), name: 'old-name' });
});
it('answers an unknown username with its failed logins only, not an error (#143)', async () => {
    const { service, model, users } = setup(
        [
            {
                _id: id,
                actor: null,
                action: AuditAction.AUTH_LOGIN_FAILED,
                targetModel: 'User',
                after: { name: 'nobody' },
                createdAt: new Date('2026-11-01T00:00:00Z'),
            },
        ],
        null,
    );
    const result = await service.list({
        page: 1,
        limit: 20,
        username: 'nobody',
    });
    expect(users.findOne).toHaveBeenCalledWith({ name: 'nobody' }, { _id: 1 });
    const filter = {
        $or: [
            { action: AuditAction.AUTH_LOGIN_FAILED, 'after.name': 'nobody' },
        ],
    };
    expect(model.find).toHaveBeenCalledWith(filter);
    expect(model.countDocuments).toHaveBeenCalledWith(filter);
    expect(result.totalItems).toBe(1);
    expect(result.data[0]).toMatchObject({
        actor: null,
        after: { name: 'nobody' },
    });
});
it('does not look up a user without a username filter', async () => {
    const { service, users } = setup();
    await service.list({ page: 1, limit: 20 });
    expect(users.findOne).not.toHaveBeenCalled();
});
it('tolerates minimized empty historical diff objects and missing attribution', async () => {
    const { service, model } = setup([
        {
            _id: id,
            actor: id,
            action: AuditAction.AUTH_LOGIN_FAILED,
            targetModel: 'User',
            createdAt: new Date(),
            ip: null,
            userAgent: null,
        },
    ]);
    const result = await service.list({ page: 1, limit: 20 });
    expect(model.find).toHaveBeenCalledWith({});
    expect(result.data[0]).toMatchObject({
        actor: { _id: String(id), name: '' },
        target: { model: 'User', id: null },
        before: {},
        after: {},
        approvedBy: null,
    });
    const empty = setup([
        {
            _id: id,
            actor: null,
            action: AuditAction.AUTH_LOGIN_FAILED,
            targetModel: 'User',
            createdAt: new Date(),
        },
    ]);
    expect(
        (await empty.service.list({ page: 1, limit: 20 })).data[0].actor,
    ).toBeNull();
});
it('bounds request metadata and isolates concurrent request contexts without copying headers/body', async () => {
    const middleware = new AuditContextMiddleware();
    const run = (ip: string, ua: string | undefined) =>
        new Promise<ReturnType<typeof auditMetadata>>((resolve) => {
            middleware.use(
                {
                    ip,
                    get: () => ua,
                    body: { password: 'secret' },
                    headers: { cookie: 'secret' },
                } as unknown as Request,
                {} as Response,
                () => {
                    setImmediate(() => resolve(auditMetadata()));
                },
            );
        });
    expect(
        await Promise.all([
            run('a'.repeat(100), 'b'.repeat(1000)),
            run('127.0.0.2', undefined),
        ]),
    ).toEqual([
        { ip: 'a'.repeat(64), userAgent: 'b'.repeat(512) },
        { ip: '127.0.0.2', userAgent: null },
    ]);
    expect(auditMetadata()).toEqual({ ip: null, userAgent: null });
    await new Promise<void>((resolve) =>
        middleware.use(
            { get: () => undefined } as unknown as Request,
            {} as Response,
            () => {
                expect(auditMetadata()).toEqual({ ip: null, userAgent: null });
                resolve();
            },
        ),
    );
});
it('uses the current database store timezone for audit date filters', async () => {
    const { service, model } = setup();
    const timezone = jest.fn().mockResolvedValue('America/Los_Angeles');
    Reflect.set(service, 'settings', { timezone });
    await service.list({
        page: 1,
        limit: 10,
        from: '2026-01-01',
        to: '2026-01-01',
    });
    expect(model.find).toHaveBeenCalledWith({
        createdAt: {
            $gte: new Date('2026-01-01T08:00:00Z'),
            $lt: new Date('2026-01-02T08:00:00Z'),
        },
    });
    expect(timezone).toHaveBeenCalledTimes(1);
});
it('resolves current target and approver names with one $in query per model (#306)', async () => {
    const ids = Array.from({ length: 8 }, () => new Types.ObjectId());
    const [user, approver, product, po, sale, shift, gone, settings] = ids;
    const base = {
        actor: null,
        actorName: null,
        before: {},
        after: {},
        ip: null,
        userAgent: null,
        createdAt: new Date('2026-11-12T00:00:00Z'),
        action: AuditAction.AUTH_LOGIN,
    };
    const rows = [
        {
            ...base,
            _id: ids[0],
            targetModel: 'User',
            targetId: user,
            approvedBy: approver,
        },
        {
            ...base,
            _id: ids[1],
            targetModel: 'User',
            targetId: approver,
            approvedBy: null,
        },
        { ...base, _id: ids[2], targetModel: 'Product', targetId: product },
        { ...base, _id: ids[3], targetModel: 'PurchaseOrder', targetId: po },
        { ...base, _id: ids[4], targetModel: 'Sales', targetId: sale },
        { ...base, _id: ids[5], targetModel: 'Shift', targetId: shift },
        { ...base, _id: ids[6], targetModel: 'Product', targetId: gone },
        { ...base, _id: settings, targetModel: 'Settings', targetId: null },
    ];
    const finder = (docs: Record<string, unknown>[]) => ({
        find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(docs) })),
    });
    const { model } = setup(rows);
    const users = finder([
        { _id: user, name: 'ana' },
        { _id: approver, name: 'boss' },
    ]);
    const models = {
        Product: finder([{ _id: product, name: 'Rice 1kg' }]),
        PurchaseOrder: finder([{ _id: po }]),
        Sales: finder([{ _id: sale }]),
        Shift: finder([
            {
                _id: shift,
                cashier: user,
                cashierName: 'ana-at-open',
                openedAt: new Date('2026-11-11T20:00:00Z'),
            },
        ]),
    };
    const service = new AuditService(
        model as unknown as Model<AuditLog>,
        { get: () => 'Asia/Manila' } as unknown as TypedConfigService,
        users as unknown as Model<User>,
        undefined,
        { models } as never,
    );
    const { data } = await service.list({ page: 1, limit: 20 } as never);
    expect(data.map((row) => row.target.label)).toEqual([
        'ana',
        'boss',
        'Rice 1kg',
        `PO-${String(po).slice(-8).toUpperCase()}`,
        String(sale).slice(-8).toUpperCase(),
        'ana · Nov 12, 2026',
        undefined,
        'Store settings',
    ]);
    expect(data[0].approvedByName).toBe('boss');
    expect('approvedByName' in data[1]).toBe(false);
    expect('label' in data[6].target).toBe(false);
    expect(users.find).toHaveBeenCalledTimes(1);
    expect(users.find).toHaveBeenCalledWith(
        { _id: { $in: [user, approver] } },
        'name',
    );
    for (const m of Object.values(models))
        expect(m.find).toHaveBeenCalledTimes(1);
    expect(models.Product.find).toHaveBeenCalledWith(
        { _id: { $in: [product, gone] } },
        'name',
    );
});
