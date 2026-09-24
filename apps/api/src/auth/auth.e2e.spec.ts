/**
 * End-to-end session flow over real HTTP (issue #32).
 *
 * Boots a Nest app with the real AuthController, AuthService, JWTStrategy,
 * RefreshTokenService, CookieService, the global JWTAuthGuard + RoleGuard and
 * GlobalFilter, plus cookie-parser and URI versioning configured as in
 * main.ts. It does not install main.ts's global ValidationPipe,
 * SanitationPipe, helmet or CORS: none of them bear on how auth failures map
 * to status codes. The persistence edges are faked: the RefreshToken model
 * (an in-memory map at the provider level) and
 * UserService.checkCredentials.
 * Requests go through Node's built-in fetch, so no supertest dependency.
 */
import { createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';
import {
    Controller,
    Get,
    INestApplication,
    VersioningType,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Types } from 'mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Roles } from './auth.decorator';
import { JWTAuthGuard } from './guards/jwt.guard';
import { RoleGuard } from './guards/role.guard';
import { JWTStrategy } from './jwt.strategy';
import { RefreshToken } from './refresh-token/refresh-token.schema';
import { RefreshTokenService } from './refresh-token/refresh-token.service';
import { CurrentUser, Role } from './types';
import type { AuthUser } from './types';
import { CookieService } from '../common/utils/cookie/cookie.service';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { GlobalFilter } from '../common/global/global.filter';
import { ErrorCode } from '../common/errors';
import { UserService } from '../user/user.service';

const COOKIE_SECRET = 'cookie-secret';
const JWT_SECRET = 'jwt-secret';
const HOUR_MS = 3_600_000;

const CONFIG: Record<string, unknown> = {
    NODE_ENV: 'test',
    DOMAIN: '',
    COOKIE_SECRET,
    JWT_SECRET,
    JWT_EXPIRY_S: 900,
    REFRESH_EXPIRY_S: 86_400,
};

const SELLER = {
    _id: new Types.ObjectId(),
    name: 'cashier',
    roles: [Role.Seller],
    isActive: true,
};

/** A route behind the real guards: any Seller (or Admin) may call it. */
@Controller('probe')
class ProbeController {
    @Roles(Role.Seller)
    @Get()
    whoAmI(@CurrentUser() user: AuthUser) {
        return { username: user.username };
    }
}

interface StoredToken {
    _id: Types.ObjectId;
    user: Types.ObjectId;
    expiry: Date;
    isValid: boolean;
}

/**
 * In-memory stand-in for the RefreshToken model, covering exactly what
 * RefreshTokenService uses: `create([doc])` and
 * `findByIdAndDelete(id)[.populate().lean()]`.
 */
class FakeRefreshTokenModel {
    readonly rows = new Map<string, StoredToken>();
    failNext = false;

    create = jest.fn(async (docs: { user: string; expiry: Date }[]) =>
        docs.map((doc) => {
            const row: StoredToken = {
                _id: new Types.ObjectId(),
                user: new Types.ObjectId(doc.user),
                expiry: doc.expiry,
                isValid: true,
            };
            this.rows.set(row._id.toString(), row);
            return row;
        }),
    );

    findByIdAndDelete = jest.fn((id: string) => {
        if (this.failNext) {
            this.failNext = false;
            throw new Error('MongoNetworkError: connection refused');
        }
        const row = this.rows.get(String(id)) ?? null;
        this.rows.delete(String(id));
        const populated = row && {
            ...row,
            user: row.user.equals(SELLER._id) ? SELLER : null,
        };
        const result = Promise.resolve(populated);
        return Object.assign(result, {
            populate: () => ({ lean: () => result }),
        });
    });

    /** Stores a token directly, as a prior login would have. */
    seed(expiry = new Date(Date.now() + HOUR_MS)): string {
        const row: StoredToken = {
            _id: new Types.ObjectId(),
            user: SELLER._id,
            expiry,
            isValid: true,
        };
        this.rows.set(row._id.toString(), row);
        return row._id.toString();
    }
}

/** cookie-parser's signed format: `s:<value>.<base64 HMAC-SHA256>`. */
function signCookie(value: string): string {
    const mac = createHmac('sha256', COOKIE_SECRET)
        .update(value)
        .digest('base64')
        .replace(/=+$/, '');
    return encodeURIComponent(`s:${value}.${mac}`);
}

function refreshCookie(refreshId: string): string {
    return `refresh=${signCookie(JSON.stringify({ refreshId }))}`;
}

/** Collects `name=value` from every Set-Cookie header of a response. */
function setCookies(res: Response): Record<string, string> {
    const out: Record<string, string> = {};
    for (const header of res.headers.getSetCookie()) {
        const [pair] = header.split(';');
        const eq = pair.indexOf('=');
        out[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    return out;
}

/** Names of the cookies a response deletes (expires them in 1970). */
function clearedCookies(res: Response): string[] {
    return res.headers
        .getSetCookie()
        .filter((header) => header.includes('Expires=Thu, 01 Jan 1970'))
        .map((header) => header.slice(0, header.indexOf('=')))
        .sort();
}

describe('Auth session flow (e2e)', () => {
    let app: INestApplication;
    let base: string;
    let model: FakeRefreshTokenModel;
    let jwt: JwtService;
    const checkCredentials = jest.fn();

    function accessToken(expiresInS: number): string {
        const nowS = Math.floor(Date.now() / 1000);
        return `jwt=${signCookie(
            jwt.sign(
                {
                    userId: SELLER._id.toString(),
                    username: SELLER.name,
                    roles: SELLER.roles,
                    iat: nowS - 1000,
                    exp: nowS + expiresInS,
                },
                { secret: JWT_SECRET },
            ),
        )}`;
    }

    function call(
        method: 'GET' | 'POST',
        path: string,
        cookies: string[] = [],
        body?: unknown,
    ): Promise<Response> {
        return fetch(`${base}${path}`, {
            method,
            headers: {
                cookie: cookies.join('; '),
                'content-type': 'application/json',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    }

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [JwtModule.register({})],
            controllers: [AuthController, ProbeController],
            providers: [
                AuthService,
                JWTStrategy,
                CookieService,
                RefreshTokenService,
                {
                    provide: getModelToken(RefreshToken.name),
                    useClass: FakeRefreshTokenModel,
                },
                { provide: UserService, useValue: { checkCredentials } },
                {
                    provide: TypedConfigService,
                    useValue: { get: (key: string) => CONFIG[key] },
                },
                { provide: APP_GUARD, useClass: JWTAuthGuard },
                { provide: APP_GUARD, useClass: RoleGuard },
                { provide: APP_FILTER, useClass: GlobalFilter },
            ],
        }).compile();

        app = moduleRef.createNestApplication({ logger: false });
        app.use(cookieParser(COOKIE_SECRET));
        app.enableVersioning({ defaultVersion: '1', type: VersioningType.URI });
        await app.listen(0, '127.0.0.1');

        const { port } = app.getHttpServer().address() as AddressInfo;
        base = `http://127.0.0.1:${port}/v1`;
        model = app.get(getModelToken(RefreshToken.name));
        jwt = app.get(JwtService);
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        model.rows.clear();
        model.failNext = false;
        checkCredentials.mockReset();
    });

    it('expired access token -> 401, refresh -> 201, replay with the new token -> 200', async () => {
        const refreshId = model.seed();
        const expired = accessToken(-60);

        const first = await call('GET', '/probe', [expired]);
        expect(first.status).toBe(401);
        expect(await first.json()).toMatchObject({
            statusCode: 401,
            error: ErrorCode.AUTH_TOKEN_EXPIRED,
        });

        // The browser still sends the expired JWT alongside the refresh cookie.
        const refreshed = await call('POST', '/auth/refresh', [
            expired,
            refreshCookie(refreshId),
        ]);
        expect(refreshed.status).toBe(201);
        const issued = setCookies(refreshed);
        expect(issued.jwt).toBeTruthy();
        expect(issued.refresh).toBeTruthy();
        expect(issued.dummy).toBe('true');

        const replay = await call('GET', '/probe', [`jwt=${issued.jwt}`]);
        expect(replay.status).toBe(200);
        expect(await replay.json()).toEqual({ username: SELLER.name });

        // The rotated refresh cookie works once more; the old one is spent.
        const again = await call('POST', '/auth/refresh', [
            `refresh=${issued.refresh}`,
        ]);
        expect(again.status).toBe(201);
    });

    it.each([
        ['no', []],
        ['a garbage', ['jwt=not-a-token']],
        ['a badly signed', [`jwt=${signCookie('a.b.c')}`]],
    ])(
        'answers a protected route with %s access token with 401 AUTH_INVALID_TOKEN',
        async (_label, cookies) => {
            const res = await call('GET', '/probe', cookies);

            expect(res.status).toBe(401);
            expect(await res.json()).toMatchObject({
                error: ErrorCode.AUTH_INVALID_TOKEN,
            });
        },
    );

    describe('every refresh failure is a 401 that clears the session', () => {
        async function expectRejected(
            cookies: string[],
            code: ErrorCode,
        ): Promise<void> {
            const res = await call('POST', '/auth/refresh', cookies);

            expect(res.status).toBe(401);
            expect(await res.json()).toMatchObject({
                statusCode: 401,
                error: code,
            });
            expect(clearedCookies(res)).toEqual(['dummy', 'jwt', 'refresh']);
        }

        it('missing cookie', () =>
            expectRejected([], ErrorCode.AUTH_MISSING_REFRESH_TOKEN));

        it('cookie with a forged signature', () =>
            expectRejected(
                [`refresh=${encodeURIComponent('s:{"refreshId":"x"}.bogus')}`],
                ErrorCode.AUTH_INVALID_TOKEN,
            ));

        it('cookie that is not JSON', () =>
            expectRejected(
                [`refresh=${signCookie('garbage')}`],
                ErrorCode.AUTH_INVALID_TOKEN,
            ));

        it('cookie whose id is not an ObjectId', () =>
            expectRejected(
                [refreshCookie('not-an-object-id')],
                ErrorCode.AUTH_INVALID_TOKEN,
            ));

        it('unknown or revoked token', () =>
            expectRejected(
                [refreshCookie(new Types.ObjectId().toString())],
                ErrorCode.AUTH_INVALID_TOKEN,
            ));

        it('expired token', () =>
            expectRejected(
                [refreshCookie(model.seed(new Date(Date.now() - 1000)))],
                ErrorCode.AUTH_TOKEN_EXPIRED,
            ));

        it('reused (already rotated) token', async () => {
            const refreshId = model.seed();
            const first = await call('POST', '/auth/refresh', [
                refreshCookie(refreshId),
            ]);
            expect(first.status).toBe(201);

            await expectRejected(
                [refreshCookie(refreshId)],
                ErrorCode.AUTH_INVALID_TOKEN,
            );
        });
    });

    it('keeps the session when refresh fails for a non-auth reason', async () => {
        const refreshId = model.seed();
        model.failNext = true;

        const res = await call('POST', '/auth/refresh', [
            refreshCookie(refreshId),
        ]);

        expect(res.status).toBe(500);
        expect(setCookies(res)).toEqual({});
    });

    describe('login and refresh while still signed in', () => {
        it('refresh with a valid access token is not 403', async () => {
            const res = await call('POST', '/auth/refresh', [
                accessToken(600),
                refreshCookie(model.seed()),
            ]);

            expect(res.status).toBe(201);
        });

        it('login with a valid access token is not 403', async () => {
            checkCredentials.mockResolvedValue(SELLER);

            const res = await call('POST', '/auth/login', [accessToken(600)], {
                username: 'cashier',
                password: 'pw',
            });

            expect(res.status).toBe(201);
            expect(await res.json()).toEqual({ user: { username: 'cashier' } });
        });
    });

    it('rejects bad login credentials with 401 AUTH_INVALID_CREDENTIALS', async () => {
        checkCredentials.mockResolvedValue(null);

        const res = await call('POST', '/auth/login', [], {
            username: 'cashier',
            password: 'wrong',
        });

        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({
            error: ErrorCode.AUTH_INVALID_CREDENTIALS,
        });
    });

    describe('logout', () => {
        it('works with an expired access token and revokes the refresh token', async () => {
            const refreshId = model.seed();

            const res = await call('POST', '/auth/logout', [
                accessToken(-60),
                refreshCookie(refreshId),
            ]);

            expect(res.status).toBe(201);
            expect(model.rows.has(refreshId)).toBe(false);
            expect(clearedCookies(res)).toEqual(['dummy', 'jwt', 'refresh']);
        });

        it('succeeds without a refresh cookie', async () => {
            const res = await call('POST', '/auth/logout', [accessToken(-60)]);

            expect(res.status).toBe(201);
        });
    });
});
