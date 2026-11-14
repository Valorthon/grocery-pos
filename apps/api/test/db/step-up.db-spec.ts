/**
 * Step-up re-authentication (#310) against a real replica set: the TTL
 * index, `POST /auth/reauth` over HTTP, and the 5-minute window checked
 * against the database clock in the guarded change's transaction.
 */
import * as argon from 'argon2';
import { Types } from 'mongoose';
import { AuditAction, ErrorCode, Role } from '@grocery-pos/contracts';
import { bootDbApp, caller, read, type DbApp } from './db-app';
import { AuditService } from '../../src/audit/audit.service';
import type { StepUp } from '../../src/auth/step-up/step-up.schema';

let db: DbApp;
const admin = caller('stepup-admin', Role.Admin);
const PASSWORD = 'password-stepup-123';

beforeAll(async () => {
    db = await bootDbApp();
    await Promise.all(
        ['User', 'StepUp', 'RefreshToken', 'AuditLog'].map((name) =>
            db.model(name).init(),
        ),
    );
    await db.model('User').create({
        _id: new Types.ObjectId(admin.userId),
        name: admin.username,
        roles: admin.roles,
        isActive: true,
        passwordHash: await argon.hash(PASSWORD),
    });
});
afterAll(async () => {
    await db?.close();
});
beforeEach(async () => {
    await db.model('StepUp').deleteMany({});
    await db.model('RefreshToken').deleteMany({});
    // `call` signs `sid` as the user id: give that session a refresh token.
    await db.model('RefreshToken').create({
        user: new Types.ObjectId(admin.userId),
        family: new Types.ObjectId(admin.userId),
        expiry: new Date(Date.now() + 3_600_000),
    });
});

const createUser = (name: string) =>
    db.call(admin, 'POST', '/users', {
        users: [{ name, password: 'password-new-1', roles: [Role.Seller] }],
    });

it('has a TTL index on expiresAt and a unique {user, sid}', async () => {
    const indexes = await db.model('StepUp').collection.indexes();
    expect(indexes).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                key: { expiresAt: 1 },
                expireAfterSeconds: 0,
            }),
            expect.objectContaining({
                key: { user: 1, sid: 1 },
                unique: true,
            }),
        ]),
    );
});

it('refuses a guarded change without a step-up, then allows it after POST /auth/reauth', async () => {
    const refused = await read(await createUser('stepup-a'));
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe(ErrorCode.USER_REAUTH_REQUIRED);

    const wrong = await db.call(admin, 'POST', '/auth/reauth', {
        password: 'not-my-password',
    });
    expect(wrong.status).toBe(403);
    expect((await read(wrong)).body.error).toBe(ErrorCode.USER_WRONG_PASSWORD);

    const ok = await db.call(admin, 'POST', '/auth/reauth', {
        password: PASSWORD,
    });
    expect(ok.status).toBe(204);
    expect((await createUser('stepup-a')).status).toBe(201);

    const actions = (
        await db
            .model<{ action: string }>('AuditLog')
            .find({ actor: new Types.ObjectId(admin.userId) })
            .lean()
    ).map((row) => row.action);
    expect(actions).toEqual(
        expect.arrayContaining([
            AuditAction.AUTH_REAUTH_FAILED,
            AuditAction.AUTH_REAUTH,
            AuditAction.USER_CREATED,
        ]),
    );
    const raw = JSON.stringify(await db.model('AuditLog').find().lean());
    expect(raw).not.toContain(PASSWORD);
    expect(raw).not.toContain('not-my-password');
});

it('honours a step-up inside its window and refuses it once expiresAt has passed', async () => {
    const user = new Types.ObjectId(admin.userId);
    const stepUps = db.model('StepUp');
    await stepUps.create({
        user,
        sid: admin.userId,
        expiresAt: new Date(Date.now() + 2_000),
    });
    expect((await createUser('stepup-b')).status).toBe(201);

    // The TTL monitor sweeps only about once a minute; the check itself
    // compares expiresAt with now.
    await stepUps.updateOne(
        { user },
        { $set: { expiresAt: new Date(Date.now() - 1) } },
    );
    const late = await read(await createUser('stepup-c'));
    expect(late.status).toBe(403);
    expect(late.body.error).toBe(ErrorCode.USER_REAUTH_REQUIRED);
});

it('a step-up whose session was revoked does not count', async () => {
    expect(
        (
            await db.call(admin, 'POST', '/auth/reauth', {
                password: PASSWORD,
            })
        ).status,
    ).toBe(204);
    await db.model('RefreshToken').deleteMany({});
    const res = await read(await createUser('stepup-d'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe(ErrorCode.USER_REAUTH_REQUIRED);
});

it.each([false, true])(
    'rolls back the grant and audit on an audit failure (prior grant: %s)',
    async (hasPriorGrant) => {
        const stepUps = db.model<StepUp>('StepUp');
        const user = new Types.ObjectId(admin.userId);
        if (hasPriorGrant) {
            await stepUps.create({
                user,
                sid: admin.userId,
                expiresAt: new Date(Date.now() + 60_000),
            });
        }
        const before = await stepUps.findOne({ user }).lean();
        const audit = db.app.get(AuditService);
        const eventsBefore = await db.model('AuditLog').countDocuments({
            action: AuditAction.AUTH_REAUTH,
        });
        const record = audit.record.bind(audit);
        const failure = jest
            .spyOn(audit, 'record')
            .mockImplementationOnce(async (event, session) => {
                // Fail after insertion so both the grant and audit rollback
                // are proved against real MongoDB, including existing grants.
                await record(event, session);
                throw new Error('forced re-auth audit outage');
            });
        let response: Response;
        try {
            response = await db.call(admin, 'POST', '/auth/reauth', {
                password: PASSWORD,
            });
        } finally {
            failure.mockRestore();
        }
        expect(response.status).toBe(500);
        expect(await stepUps.findOne({ user }).lean()).toEqual(before);
        expect(
            await db.model('AuditLog').countDocuments({
                action: AuditAction.AUTH_REAUTH,
            }),
        ).toBe(eventsBefore);
        const guarded = await read(
            await createUser(`stepup-rollback-${String(hasPriorGrant)}`),
        );
        expect(guarded.status).toBe(hasPriorGrant ? 201 : 403);
        if (!hasPriorGrant)
            expect(guarded.body.error).toBe(ErrorCode.USER_REAUTH_REQUIRED);
    },
);
