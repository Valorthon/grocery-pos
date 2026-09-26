/**
 * `/v1/users` over real HTTP (issue #3), in the style of auth.e2e.spec.ts.
 *
 * Boots a Nest app with the real UserController, UserService, JWTStrategy,
 * global JWTAuthGuard + RoleGuard, GlobalFilter and main.ts's
 * ValidationPipe options, so each rule is checked the way a browser hits it.
 * The persistence edge is faked: an in-memory User model and a connection
 * whose transactions are serialized and roll back on a throw.
 */
import { createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { INestApplication, VersioningType } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as argon from 'argon2';
import { Types } from 'mongoose';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User } from './user.schema';
import { JWTAuthGuard } from '../auth/guards/jwt.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { JWTStrategy } from '../auth/jwt.strategy';
import { Role } from '../auth/types';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { GlobalFilter } from '../common/global/global.filter';
import { createValidationPipe } from '../common/pipes/validation.pipe';
import { ErrorCode } from '../common/errors';
import {
    FakeUserModel,
    FakeUserRow,
    fakeConnection,
} from './testing/fake-user-model';
import { RefreshToken } from '../auth/refresh-token/refresh-token.schema';
import { RefreshTokenService } from '../auth/refresh-token/refresh-token.service';
import { FakeRefreshTokenModel } from '../auth/refresh-token/testing/fake-refresh-token-model';
import { RATE_LIMITS, RateLimitModule } from '../auth/rate-limit/rate-limit';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import { STRING_LIMITS } from '../constants';

const COOKIE_SECRET = 'cookie-secret';
const JWT_SECRET = 'jwt-secret';

/** cookie-parser's signed format: `s:<value>.<base64 HMAC-SHA256>`. */
function signCookie(value: string): string {
    const mac = createHmac('sha256', COOKIE_SECRET)
        .update(value)
        .digest('base64')
        .replace(/=+$/, '');
    return encodeURIComponent(`s:${value}.${mac}`);
}

describe('Users (e2e)', () => {
    let app: INestApplication;
    let base: string;
    let jwt: JwtService;
    const model = new FakeUserModel();
    const tokens = new FakeRefreshTokenModel();
    let throttles: ThrottlerStorageService;

    let admin: FakeUserRow;
    let manager: FakeUserRow;
    let cashier: FakeUserRow;

    function sessionOf(row: FakeUserRow, sid?: string): string {
        return `jwt=${signCookie(
            jwt.sign(
                {
                    userId: row._id.toString(),
                    username: row.name,
                    roles: row.roles,
                    ...(sid ? { sid } : {}),
                },
                { secret: JWT_SECRET, expiresIn: 600 },
            ),
        )}`;
    }

    async function call(
        as: FakeUserRow,
        method: 'GET' | 'POST' | 'PATCH',
        path: string,
        body?: unknown,
        sid?: string,
    ): Promise<{ status: number; body: Record<string, unknown> }> {
        const res = await fetch(`${base}${path}`, {
            method,
            headers: {
                cookie: sessionOf(as, sid),
                'content-type': 'application/json',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : {} };
    }

    const patchUsers = (
        as: FakeUserRow,
        updates: { user: string; update: Record<string, unknown> }[],
    ) => call(as, 'PATCH', '/users', { updates });

    const id = (row: FakeUserRow) => row._id.toString();

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [JwtModule.register({}), RateLimitModule],
            controllers: [UserController],
            providers: [
                UserService,
                RefreshTokenService,
                { provide: getModelToken(RefreshToken.name), useValue: tokens },
                JWTStrategy,
                { provide: getModelToken(User.name), useValue: model },
                {
                    provide: getConnectionToken(),
                    useValue: fakeConnection(model),
                },
                {
                    provide: TypedConfigService,
                    useValue: {
                        get: (key: string) =>
                            key === 'JWT_SECRET' ? JWT_SECRET : undefined,
                    },
                },
                { provide: APP_GUARD, useClass: JWTAuthGuard },
                { provide: APP_GUARD, useClass: RoleGuard },
                { provide: APP_FILTER, useClass: GlobalFilter },
            ],
        }).compile();

        app = moduleRef.createNestApplication({ logger: false });
        app.use(cookieParser(COOKIE_SECRET));
        app.useGlobalPipes(createValidationPipe());
        app.enableVersioning({ defaultVersion: '1', type: VersioningType.URI });
        await app.listen(0, '127.0.0.1');

        const { port } = app.getHttpServer().address() as AddressInfo;
        base = `http://127.0.0.1:${port}/v1`;
        jwt = app.get(JwtService);
        throttles = app.get(getStorageToken());
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(async () => {
        model.rows = [];
        model.writes.length = 0;
        tokens.rows.clear();
        throttles.storage.clear();
        const hash = await argon.hash('secret');
        admin = model.seed({
            name: 'admin',
            roles: [Role.Admin],
            passwordHash: hash,
        });
        manager = model.seed({
            name: 'manager',
            roles: [Role.UserManager],
            passwordHash: hash,
        });
        cashier = model.seed({
            name: 'cashier',
            roles: [Role.Seller],
            passwordHash: hash,
        });
    });

    describe('Verification from the issue', () => {
        it('USER_MANAGER promoting themselves to ADMIN -> 403', async () => {
            const res = await patchUsers(manager, [
                { user: id(manager), update: { roles: [Role.Admin] } },
            ]);

            expect(res.status).toBe(403);
            expect(res.body).toMatchObject({
                statusCode: 403,
                error: ErrorCode.USER_SELF_ROLE_CHANGE,
            });
            expect(model.byId(manager._id)?.roles).toEqual([Role.UserManager]);
        });

        it("USER_MANAGER resetting the ADMIN's password -> 403", async () => {
            const before = model.byId(admin._id)?.passwordHash;

            const res = await patchUsers(manager, [
                { user: id(admin), update: { password: 'taken-over' } },
            ]);

            expect(res.status).toBe(403);
            expect(res.body).toMatchObject({
                error: ErrorCode.USER_TARGET_FORBIDDEN,
            });
            expect(model.byId(admin._id)?.passwordHash).toBe(before);
        });
    });

    it('USER_MANAGER creating an ADMIN -> 403, nothing inserted', async () => {
        const res = await call(manager, 'POST', '/users', {
            users: [
                { name: 'mole', password: 'password123', roles: [Role.Admin] },
            ],
        });

        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({
            error: ErrorCode.USER_ROLE_NOT_GRANTABLE,
        });
        expect(model.rows.some((r) => r.name === 'mole')).toBe(false);
    });

    it('USER_MANAGER creating a USER_MANAGER -> 403', async () => {
        const res = await call(manager, 'POST', '/users', {
            users: [
                {
                    name: 'm2',
                    password: 'password123',
                    roles: [Role.UserManager],
                },
            ],
        });

        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({
            error: ErrorCode.USER_ROLE_NOT_GRANTABLE,
        });
    });

    it('USER_MANAGER creating a cashier -> 201', async () => {
        const res = await call(manager, 'POST', '/users', {
            users: [
                {
                    name: 'till2',
                    password: 'password123',
                    roles: [Role.Seller],
                },
            ],
        });

        expect(res.status).toBe(201);
    });

    it('USER_MANAGER re-roling and deactivating a cashier -> 200', async () => {
        const res = await patchUsers(manager, [
            {
                user: id(cashier),
                update: { roles: [Role.Restocker], isActive: false },
            },
        ]);

        expect(res.status).toBe(200);
        expect(model.byId(cashier._id)).toMatchObject({
            roles: [Role.Restocker],
            isActive: false,
        });
    });

    it('USER_MANAGER deactivating another manager -> 403', async () => {
        const other = model.seed({
            name: 'manager2',
            roles: [Role.UserManager],
        });

        const res = await patchUsers(manager, [
            { user: id(other), update: { isActive: false } },
        ]);

        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({
            error: ErrorCode.USER_TARGET_FORBIDDEN,
        });
    });

    it('USER_MANAGER deactivating the ADMIN -> 403', async () => {
        const res = await patchUsers(manager, [
            { user: id(admin), update: { isActive: false } },
        ]);

        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({
            error: ErrorCode.USER_TARGET_FORBIDDEN,
        });
        expect(model.byId(admin._id)?.isActive).toBe(true);
    });

    it("USER_MANAGER resetting a cashier's password -> 403", async () => {
        const res = await patchUsers(manager, [
            { user: id(cashier), update: { password: 'password123' } },
        ]);

        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({
            error: ErrorCode.USER_PASSWORD_RESET_FORBIDDEN,
        });
    });

    it("ADMIN resetting a cashier's password -> 200", async () => {
        const res = await patchUsers(admin, [
            { user: id(cashier), update: { password: 'reset-pw' } },
        ]);

        expect(res.status).toBe(200);
        await expect(
            argon.verify(model.byId(cashier._id)!.passwordHash, 'reset-pw'),
        ).resolves.toBe(true);
    });

    it('ADMIN changing their own roles -> 403', async () => {
        const res = await patchUsers(admin, [
            { user: id(admin), update: { roles: [Role.Seller] } },
        ]);

        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({
            error: ErrorCode.USER_SELF_ROLE_CHANGE,
        });
    });

    it('the edit form resending unchanged own roles -> 200', async () => {
        const res = await patchUsers(manager, [
            {
                user: id(manager),
                update: { roles: [Role.UserManager], isActive: true },
            },
        ]);

        expect(res.status).toBe(200);
    });

    describe('self-edits (issue #61)', () => {
        it('USER_MANAGER renaming themselves -> 200', async () => {
            const res = await patchUsers(manager, [
                {
                    user: id(manager),
                    update: {
                        name: 'boss',
                        roles: [Role.UserManager],
                        isActive: true,
                    },
                },
            ]);

            expect(res.status).toBe(200);
            expect(model.byId(manager._id)).toMatchObject({
                name: 'boss',
                isActive: true,
            });
        });

        it('USER_MANAGER deactivating themselves -> 403, nothing applied', async () => {
            const res = await patchUsers(manager, [
                {
                    user: id(manager),
                    update: { name: 'gone', isActive: false },
                },
            ]);

            expect(res.status).toBe(403);
            expect(res.body).toMatchObject({
                statusCode: 403,
                error: ErrorCode.USER_SELF_DEACTIVATE,
            });
            expect(model.byId(manager._id)).toMatchObject({
                name: 'manager',
                isActive: true,
            });
        });

        it('a bulk update that also deactivates the manager -> 403, nothing applied', async () => {
            const res = await patchUsers(manager, [
                { user: id(cashier), update: { isActive: false } },
                { user: id(manager), update: { isActive: false } },
            ]);

            expect(res.status).toBe(403);
            expect(res.body).toMatchObject({
                error: ErrorCode.USER_SELF_DEACTIVATE,
            });
            expect(model.byId(cashier._id)?.isActive).toBe(true);
            expect(model.byId(manager._id)?.isActive).toBe(true);
        });

        it('the only ADMIN deactivating themselves -> 403 last admin', async () => {
            const res = await patchUsers(admin, [
                { user: id(admin), update: { isActive: false } },
            ]);

            expect(res.status).toBe(403);
            expect(res.body).toMatchObject({
                error: ErrorCode.USER_LAST_ADMIN,
            });
            expect(model.byId(admin._id)?.isActive).toBe(true);
        });

        it('an ADMIN deactivating themselves with another admin left -> 200', async () => {
            model.seed({ name: 'admin2', roles: [Role.Admin] });

            const res = await patchUsers(admin, [
                { user: id(admin), update: { isActive: false } },
            ]);

            expect(res.status).toBe(200);
            expect(model.byId(admin._id)?.isActive).toBe(false);
        });
    });

    describe('last active ADMIN', () => {
        let admin2: FakeUserRow;

        beforeEach(() => {
            admin2 = model.seed({ name: 'admin2', roles: [Role.Admin] });
        });

        it('a bulk update removing every admin -> 403, nothing applied', async () => {
            const res = await patchUsers(admin, [
                { user: id(admin2), update: { roles: [Role.UserManager] } },
                { user: id(admin), update: { isActive: false } },
            ]);

            expect(res.status).toBe(403);
            expect(res.body).toMatchObject({
                error: ErrorCode.USER_LAST_ADMIN,
            });
            expect(model.byId(admin2._id)?.roles).toEqual([Role.Admin]);
            expect(model.byId(admin._id)?.isActive).toBe(true);
        });

        // The fake model serializes transactions, so this checks that the
        // second request sees the first one's commit and is refused, not
        // snapshot isolation. The admin write-lock that prevents write skew
        // on a real replica set is covered by user.service.spec.ts (lock
        // ordering) and was verified manually against mongo:7 (see PR #58).
        it('two concurrent cross-demotions -> one 200, one 403', async () => {
            const [a, b] = await Promise.all([
                patchUsers(admin, [
                    { user: id(admin2), update: { roles: [Role.Seller] } },
                ]),
                patchUsers(admin2, [
                    { user: id(admin), update: { roles: [Role.Seller] } },
                ]),
            ]);

            expect([a.status, b.status].sort()).toEqual([200, 403]);
            expect(
                model.rows.filter(
                    (r) => r.isActive && r.roles.includes(Role.Admin),
                ),
            ).toHaveLength(1);
        });
    });

    describe('validation -> 400', () => {
        // Its own query DTO, not the product list's (#16, #27): a name is
        // bounded like a username, and there is no barcode to search.
        it('GET with a name up to the username limit -> 200', async () => {
            const name = 'a'.repeat(STRING_LIMITS.USERNAME);
            const res = await call(
                admin,
                'GET',
                `/users?page=1&limit=5&name=${name}`,
            );

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ data: [], totalItems: 0 });
        });

        it('GET with a name past the username limit -> 400', async () => {
            const name = 'a'.repeat(STRING_LIMITS.USERNAME + 1);
            const res = await call(
                admin,
                'GET',
                `/users?page=1&limit=5&name=${name}`,
            );

            expect(res.status).toBe(400);
            expect(res.body.error).toBe(ErrorCode.VALIDATION_INVALID_INPUT);
        });

        it('GET with an EAN param -> 400', async () => {
            const res = await call(
                admin,
                'GET',
                '/users?page=1&limit=5&EAN=480',
            );

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('property EAN should not exist');
        });

        it.each([
            ['UNAUTHENTICATED', [Role.Unauthenticated]],
            ['an unknown role', ['GOD']],
            ['no roles', []],
            ['a duplicated role', [Role.Seller, Role.Seller]],
            ['a non-array', Role.Seller],
        ])('PATCH with %s', async (_label, roles) => {
            const res = await patchUsers(admin, [
                { user: id(cashier), update: { roles } },
            ]);

            expect(res.status).toBe(400);
            expect(model.byId(cashier._id)?.roles).toEqual([Role.Seller]);
        });

        it('POST with UNAUTHENTICATED', async () => {
            const res = await call(admin, 'POST', '/users', {
                users: [
                    {
                        name: 'ghost',
                        password: 'password123',
                        roles: [Role.Unauthenticated],
                    },
                ],
            });

            expect(res.status).toBe(400);
        });

        it('PATCH with a blank name', async () => {
            const res = await patchUsers(admin, [
                { user: id(cashier), update: { name: '   ' } },
            ]);

            expect(res.status).toBe(400);
        });

        it.each([
            ['a string', 'x'],
            ['an array', [{ name: 'x' }]],
        ])('PATCH with update as %s', async (_label, update) => {
            const res = await call(admin, 'PATCH', '/users', {
                updates: [{ user: id(cashier), update }],
            });

            expect(res.status).toBe(400);
        });

        it('PATCH naming the same user twice', async () => {
            const res = await patchUsers(admin, [
                { user: id(cashier), update: { isActive: false } },
                { user: id(cashier), update: { isActive: true } },
            ]);

            expect(res.status).toBe(400);
        });
    });

    describe('PATCH /users/me/password', () => {
        it('lets a cashier change their own password', async () => {
            const res = await call(cashier, 'PATCH', '/users/me/password', {
                currentPassword: 'secret',
                newPassword: 'fresh-secret',
            });

            expect(res.status).toBe(200);
            await expect(
                argon.verify(
                    model.byId(cashier._id)!.passwordHash,
                    'fresh-secret',
                ),
            ).resolves.toBe(true);
        });

        it('wrong current password -> 403 (not 401, which would end the session)', async () => {
            const res = await call(cashier, 'PATCH', '/users/me/password', {
                currentPassword: 'guess',
                newPassword: 'fresh-secret',
            });

            expect(res.status).toBe(403);
            expect(res.body).toMatchObject({
                error: ErrorCode.USER_WRONG_PASSWORD,
            });
        });

        it('missing current password -> 400', async () => {
            const res = await call(cashier, 'PATCH', '/users/me/password', {
                newPassword: 'fresh-secret',
            });

            expect(res.status).toBe(400);
        });

        it('a cashier still cannot reach PATCH /users', async () => {
            const res = await patchUsers(cashier, [
                { user: id(cashier), update: { roles: [Role.Admin] } },
            ]);

            expect(res.status).toBe(403);
            expect(model.byId(cashier._id)?.roles).toEqual([Role.Seller]);
        });
    });

    it('rejects a request with no session with 401', async () => {
        const res = await fetch(`${base}/users`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                updates: [{ user: new Types.ObjectId(), update: {} }],
            }),
        });

        expect(res.status).toBe(401);
    });

    describe('sessions end when access changes (#12)', () => {
        /** Two signed-in sessions (refresh tokens) for each of `rows`. */
        function signIn(...rows: FakeUserRow[]) {
            for (const row of rows) {
                tokens.seed(row._id);
                tokens.seed(row._id);
            }
        }

        it('deactivating a user revokes all their refresh tokens', async () => {
            signIn(cashier, manager);

            const res = await patchUsers(manager, [
                { user: id(cashier), update: { isActive: false } },
            ]);

            expect(res.status).toBe(200);
            expect(tokens.tokensOf(cashier._id)).toEqual([]);
            expect(tokens.tokensOf(manager._id)).toHaveLength(2);
        });

        it('changing a user’s roles revokes their refresh tokens', async () => {
            signIn(cashier);

            const res = await patchUsers(manager, [
                { user: id(cashier), update: { roles: [Role.Restocker] } },
            ]);

            expect(res.status).toBe(200);
            expect(tokens.tokensOf(cashier._id)).toEqual([]);
        });

        it('an admin password reset revokes the target’s refresh tokens', async () => {
            signIn(cashier);

            const res = await patchUsers(admin, [
                { user: id(cashier), update: { password: 'reset-password' } },
            ]);

            expect(res.status).toBe(200);
            expect(tokens.tokensOf(cashier._id)).toEqual([]);
        });

        it('an edit that changes no access keeps the sessions', async () => {
            signIn(cashier);

            const res = await patchUsers(manager, [
                {
                    user: id(cashier),
                    update: { roles: [Role.Seller], isActive: true },
                },
            ]);

            expect(res.status).toBe(200);
            expect(tokens.tokensOf(cashier._id)).toHaveLength(2);
        });

        it('a refused update revokes nothing', async () => {
            signIn(admin);

            const res = await patchUsers(manager, [
                { user: id(admin), update: { isActive: false } },
            ]);

            expect(res.status).toBe(403);
            expect(tokens.tokensOf(admin._id)).toHaveLength(2);
        });

        it('changing your own password ends your other sessions but keeps this one', async () => {
            const mine = new Types.ObjectId();
            const keep = tokens.seed(cashier._id, { family: mine });
            signIn(cashier, manager);

            const res = await call(
                cashier,
                'PATCH',
                '/users/me/password',
                { currentPassword: 'secret', newPassword: 'fresh-secret' },
                mine.toString(),
            );

            expect(res.status).toBe(200);
            expect(
                tokens.tokensOf(cashier._id).map((t) => t._id.toString()),
            ).toEqual([keep]);
            expect(tokens.tokensOf(manager._id)).toHaveLength(2);
        });

        it('without a session id in the token, a password change ends every session', async () => {
            tokens.seed(cashier._id);
            signIn(cashier);

            const res = await call(cashier, 'PATCH', '/users/me/password', {
                currentPassword: 'secret',
                newPassword: 'fresh-secret',
            });

            expect(res.status).toBe(200);
            expect(tokens.tokensOf(cashier._id)).toEqual([]);
        });

        it('a failed password change revokes nothing', async () => {
            signIn(cashier);

            const res = await call(cashier, 'PATCH', '/users/me/password', {
                currentPassword: 'guess',
                newPassword: 'fresh-secret',
            });

            expect(res.status).toBe(403);
            expect(tokens.tokensOf(cashier._id)).toHaveLength(2);
        });
    });

    describe(`password policy: at least ${STRING_LIMITS.PASSWORD_MIN} characters (#12)`, () => {
        const short = 'x'.repeat(STRING_LIMITS.PASSWORD_MIN - 1);
        const enough = 'x'.repeat(STRING_LIMITS.PASSWORD_MIN);

        it('on create', async () => {
            const tooShort = await call(admin, 'POST', '/users', {
                users: [
                    { name: 'till9', password: short, roles: [Role.Seller] },
                ],
            });
            expect(tooShort.status).toBe(400);
            expect(String(tooShort.body.message)).toMatch(/password/);

            const ok = await call(admin, 'POST', '/users', {
                users: [
                    { name: 'till9', password: enough, roles: [Role.Seller] },
                ],
            });
            expect(ok.status).toBe(201);
        });

        it('on an admin reset', async () => {
            const tooShort = await patchUsers(admin, [
                { user: id(cashier), update: { password: short } },
            ]);
            expect(tooShort.status).toBe(400);

            const ok = await patchUsers(admin, [
                { user: id(cashier), update: { password: enough } },
            ]);
            expect(ok.status).toBe(200);
        });

        it('on the new password of /me/password, but not the current one', async () => {
            model.byId(cashier._id)!.passwordHash = await argon.hash('old');

            const tooShort = await call(
                cashier,
                'PATCH',
                '/users/me/password',
                {
                    currentPassword: 'old',
                    newPassword: short,
                },
            );
            expect(tooShort.status).toBe(400);

            // A legacy short current password is still accepted.
            const ok = await call(cashier, 'PATCH', '/users/me/password', {
                currentPassword: 'old',
                newPassword: enough,
            });
            expect(ok.status).toBe(200);
        });
    });

    it(`PATCH /users/me/password: ${RATE_LIMITS.password.account.limit} tries per user, then 429 (#12)`, async () => {
        const attempt = (as: FakeUserRow) =>
            call(as, 'PATCH', '/users/me/password', {
                currentPassword: 'guess',
                newPassword: 'fresh-secret',
            });

        for (let i = 0; i < RATE_LIMITS.password.account.limit; i++) {
            expect((await attempt(cashier)).status).toBe(403);
        }

        const blocked = await attempt(cashier);
        expect(blocked.status).toBe(429);
        expect(blocked.body).toMatchObject({
            statusCode: 429,
            error: ErrorCode.RATE_LIMITED,
        });

        // Another user on the same IP is unaffected.
        expect((await attempt(manager)).status).toBe(403);
    });
});
