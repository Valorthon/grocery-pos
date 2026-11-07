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
    const users = { findOne: jest.fn(() => userQuery) };
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
        actor: id,
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
    expect(model.find).toHaveBeenCalledWith({ actor: id });
    expect(model.countDocuments).toHaveBeenCalledWith({ actor: id });
    expect(result.data[0].actor).toEqual({ _id: String(id), name: 'old-name' });
});
it('answers an unknown username with an empty page, not an error (#143)', async () => {
    const { service, model, users } = setup([{ _id: id }], null);
    await expect(
        service.list({ page: 1, limit: 20, username: 'nobody' }),
    ).resolves.toEqual({ totalItems: 0, data: [] });
    expect(users.findOne).toHaveBeenCalledWith({ name: 'nobody' }, { _id: 1 });
    expect(model.find).not.toHaveBeenCalled();
    expect(model.countDocuments).not.toHaveBeenCalled();
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
