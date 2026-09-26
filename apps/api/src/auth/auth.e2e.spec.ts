/**
 * End-to-end session flow over real HTTP (issue #32).
 *
 * Boots a Nest app with the real AuthController, AuthService, JWTStrategy,
 * RefreshTokenService, CookieService, the global JWTAuthGuard + RoleGuard and
 * GlobalFilter, plus cookie-parser, URI versioning and main.ts's global
 * ValidationPipe (the login rate limit must agree with what it makes of a
 * username). It does not install helmet or CORS: neither bears on
 * how auth failures map to status codes. The persistence edges are faked: the RefreshToken model
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
import {
    FakeRefreshTokenModel,
    TokenOwner,
} from './refresh-token/testing/fake-refresh-token-model';
import { RATE_LIMITS, RateLimitModule } from './rate-limit/rate-limit';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import { INVALID_CREDENTIALS_MESSAGE } from './auth.service';
import { CurrentUser, Role } from './types';
import type { AuthUser } from './types';
import { CookieService } from '../common/utils/cookie/cookie.service';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { GlobalFilter } from '../common/global/global.filter';
import { createValidationPipe } from '../common/pipes/validation.pipe';
import { ErrorCode } from '../common/errors';
import { UserService } from '../user/user.service';

const COOKIE_SECRET = 'cookie-secret';
const JWT_SECRET = 'jwt-secret';

const CONFIG: Record<string, unknown> = {
    APP_ENV: 'test',
    DOMAIN: '',
    COOKIE_SECRET,
    JWT_SECRET,
    JWT_EXPIRY_S: 900,
    REFRESH_EXPIRY_S: 86_400,
};

const SELLER: TokenOwner = {
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

/** `name@path` of each cookie a response deletes (expires it in 1970). */
function clearedAt(res: Response): string[] {
    return res.headers
        .getSetCookie()
        .filter((header) => header.includes('Expires=Thu, 01 Jan 1970'))
        .map(
            (header) =>
                `${header.slice(0, header.indexOf('='))}@${/Path=([^;]*)/.exec(header)?.[1]}`,
        )
        .sort();
}

/** Names of the cookies a response deletes. */
function clearedCookies(res: Response): string[] {
    return [...new Set(clearedAt(res).map((c) => c.split('@')[0]))].sort();
}

/** The Path attribute a response gives to the cookie it sets as `name`. */
function pathOfSet(res: Response, name: string): string | undefined {
    const header = res.headers
        .getSetCookie()
        .find(
            (h) =>
                h.startsWith(`${name}=`) &&
                !h.includes('Expires=Thu, 01 Jan 1970'),
        );
    return header && /Path=([^;]*)/.exec(header)?.[1];
}

/** The Max-Age (seconds) and Expires a response gives the cookie it sets as `name`. */
function lifetimeOf(
    res: Response,
    name: string,
): { maxAgeS: number; expires: number } | undefined {
    const header = res.headers
        .getSetCookie()
        .find(
            (h) =>
                h.startsWith(`${name}=`) &&
                !h.includes('Expires=Thu, 01 Jan 1970'),
        );
    if (!header) return undefined;
    return {
        maxAgeS: Number(/Max-Age=(\d+)/.exec(header)?.[1]),
        expires: Date.parse(/Expires=([^;]*)/.exec(header)?.[1] ?? ''),
    };
}

/** Fakes only the clock, so real sockets and timers keep working. */
function fakeClock(now: Date): void {
    jest.useFakeTimers({
        now,
        doNotFake: [
            'hrtime',
            'nextTick',
            'performance',
            'queueMicrotask',
            'requestAnimationFrame',
            'cancelAnimationFrame',
            'requestIdleCallback',
            'cancelIdleCallback',
            'setImmediate',
            'clearImmediate',
            'setInterval',
            'clearInterval',
            'setTimeout',
            'clearTimeout',
        ],
    });
}

const HOUR_S = 3600;

describe('Auth session flow (e2e)', () => {
    let app: INestApplication;
    let base: string;
    let model: FakeRefreshTokenModel;
    let jwt: JwtService;
    let throttles: ThrottlerStorageService;
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
            imports: [JwtModule.register({}), RateLimitModule],
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
        // main.ts's global pipe: the login throttle has to key on what it
        // turns the username into.
        app.useGlobalPipes(createValidationPipe());
        app.enableVersioning({ defaultVersion: '1', type: VersioningType.URI });
        await app.listen(0, '127.0.0.1');

        const { port } = app.getHttpServer().address() as AddressInfo;
        base = `http://127.0.0.1:${port}/v1`;
        model = app.get(getModelToken(RefreshToken.name));
        jwt = app.get(JwtService);
        throttles = app.get(getStorageToken());
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        model.rows.clear();
        model.users.clear();
        model.addUser(SELLER);
        SELLER.isActive = true;
        model.failNext = null;
        checkCredentials.mockReset();
        // Every test starts with a full rate-limit budget.
        throttles.storage.clear();
    });

    it('expired access token -> 401, refresh -> 201, replay with the new token -> 200', async () => {
        const refreshId = model.seed(SELLER);
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
                [
                    refreshCookie(
                        model.seed(SELLER, {
                            expiry: new Date(Date.now() - 1000),
                        }),
                    ),
                ],
                ErrorCode.AUTH_TOKEN_EXPIRED,
            ));

        it('reused (already rotated) token', async () => {
            const refreshId = model.seed(SELLER);
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
        const refreshId = model.seed(SELLER);
        model.failNext = 'findById';

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
                refreshCookie(model.seed(SELLER)),
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

    it('passes the login password through verbatim: no trim, no encoding (#15)', async () => {
        checkCredentials.mockResolvedValue(null);
        const password = '  p&ss <w>ord>  ';

        await call('POST', '/auth/login', [], {
            username: '  Cashier ',
            password,
        });

        expect(checkCredentials).toHaveBeenCalledWith('cashier', password);
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
            const refreshId = model.seed(SELLER);

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

    describe('logout revokes the session a browser actually holds (#12)', () => {
        /**
         * What a browser would send to `path`: each cookie set by `res`
         * whose Path path-matches it (RFC 6265 5.1.4), minus deletions.
         */
        function browserCookiesFor(res: Response, path: string): string[] {
            return res.headers
                .getSetCookie()
                .filter((h) => !h.includes('Expires=Thu, 01 Jan 1970'))
                .filter((h) => {
                    const cookiePath = /Path=([^;]*)/.exec(h)?.[1] ?? '/';
                    return (
                        path === cookiePath ||
                        (path.startsWith(cookiePath) &&
                            (cookiePath.endsWith('/') ||
                                path[cookiePath.length] === '/'))
                    );
                })
                .map((h) => h.split(';')[0]);
        }

        it('scopes the refresh cookie to /v1/auth, so /auth/logout receives it', async () => {
            checkCredentials.mockResolvedValue(SELLER);
            const login = await call('POST', '/auth/login', [], {
                username: 'cashier',
                password: 'password123',
            });
            expect(login.status).toBe(201);
            expect(pathOfSet(login, 'refresh')).toBe('/v1/auth');
            expect(model.tokensOf(SELLER)).toHaveLength(1);

            const sent = browserCookiesFor(login, '/v1/auth/logout');
            expect(sent.some((c) => c.startsWith('refresh='))).toBe(true);

            const logout = await call('POST', '/auth/logout', sent);

            expect(logout.status).toBe(201);
            expect(model.tokensOf(SELLER)).toEqual([]);
        });

        it('clears the refresh cookie on both the new and the legacy path', async () => {
            const res = await call('POST', '/auth/logout', [
                refreshCookie(model.seed(SELLER)),
            ]);

            expect(clearedAt(res)).toEqual(
                expect.arrayContaining([
                    'refresh@/v1/auth',
                    'refresh@/v1/auth/refresh',
                ]),
            );
        });

        it('migrates a legacy-path cookie on refresh', async () => {
            const res = await call('POST', '/auth/refresh', [
                refreshCookie(model.seed(SELLER)),
            ]);

            expect(res.status).toBe(201);
            expect(pathOfSet(res, 'refresh')).toBe('/v1/auth');
            expect(clearedAt(res)).toContain('refresh@/v1/auth/refresh');
        });
    });

    describe('fixed-length sessions: cookies expire with the session (#21)', () => {
        const LOGIN_AT = new Date('2026-09-01T08:00:00.000Z');
        const SESSION_END = LOGIN_AT.getTime() + 86_400 * 1000;

        afterEach(() => jest.useRealTimers());

        async function logIn(): Promise<Response> {
            checkCredentials.mockResolvedValue(SELLER);
            const res = await call('POST', '/auth/login', [], {
                username: 'cashier',
                password: 'password123',
            });
            expect(res.status).toBe(201);
            return res;
        }

        it('login: the refresh and marker cookies last REFRESH_EXPIRY_S, the access cookie JWT_EXPIRY_S', async () => {
            fakeClock(LOGIN_AT);

            const login = await logIn();

            for (const name of ['refresh', 'dummy']) {
                expect(lifetimeOf(login, name)).toEqual({
                    maxAgeS: 86_400,
                    expires: SESSION_END,
                });
            }
            expect(lifetimeOf(login, 'jwt')?.maxAgeS).toBe(900);
            const [token] = model.tokensOf(SELLER);
            expect(token.expiry.getTime()).toBe(SESSION_END);
        });

        it('refresh 10h after login: the cookies keep the login expiry (14h left), not a fresh day', async () => {
            fakeClock(LOGIN_AT);
            const login = await logIn();
            const { refresh } = setCookies(login);

            jest.setSystemTime(LOGIN_AT.getTime() + 10 * HOUR_S * 1000);
            const refreshed = await call('POST', '/auth/refresh', [
                `refresh=${refresh}`,
            ]);

            expect(refreshed.status).toBe(201);
            for (const name of ['refresh', 'dummy']) {
                expect(lifetimeOf(refreshed, name)).toEqual({
                    maxAgeS: 14 * HOUR_S,
                    expires: SESSION_END,
                });
            }
            expect(lifetimeOf(refreshed, 'jwt')?.maxAgeS).toBe(900);
            const [token] = model.tokensOf(SELLER);
            expect(token.expiry.getTime()).toBe(SESSION_END);
        });

        it('the last access token of a session does not outlive it', async () => {
            fakeClock(LOGIN_AT);
            const refreshId = model.seed(SELLER, {
                expiry: new Date(LOGIN_AT.getTime() + 60_000),
            });

            const refreshed = await call('POST', '/auth/refresh', [
                refreshCookie(refreshId),
            ]);

            expect(refreshed.status).toBe(201);
            expect(lifetimeOf(refreshed, 'jwt')?.maxAgeS).toBe(60);
            expect(lifetimeOf(refreshed, 'refresh')?.maxAgeS).toBe(60);
            const signed = decodeURIComponent(setCookies(refreshed).jwt);
            const { exp } = jwt.decode(
                signed.slice(2).replace(/\.[^.]+$/, ''),
            ) as { exp: number };
            expect(exp * 1000).toBe(LOGIN_AT.getTime() + 60_000);
        });
    });

    describe('sessions of users who lost access (#12)', () => {
        it('refresh for a deactivated user -> 401, cookies cleared, sessions gone', async () => {
            const refreshId = model.seed(SELLER);
            model.seed(SELLER);
            SELLER.isActive = false;

            const res = await call('POST', '/auth/refresh', [
                refreshCookie(refreshId),
            ]);

            expect(res.status).toBe(401);
            expect(await res.json()).toMatchObject({
                error: ErrorCode.AUTH_INVALID_TOKEN,
            });
            expect(clearedCookies(res)).toEqual(['dummy', 'jwt', 'refresh']);
            expect(model.tokensOf(SELLER)).toEqual([]);
        });

        it('refresh for a deleted user -> 401, not 500', async () => {
            const refreshId = model.seed(new Types.ObjectId());

            const res = await call('POST', '/auth/refresh', [
                refreshCookie(refreshId),
            ]);

            expect(res.status).toBe(401);
            expect(clearedCookies(res)).toEqual(['dummy', 'jwt', 'refresh']);
        });

        it('a failed rotation keeps the session: 500, no cookies, old token still works', async () => {
            const refreshId = model.seed(SELLER);
            model.failNext = 'create';

            const failed = await call('POST', '/auth/refresh', [
                refreshCookie(refreshId),
            ]);
            expect(failed.status).toBe(500);
            expect(setCookies(failed)).toEqual({});

            const retry = await call('POST', '/auth/refresh', [
                refreshCookie(refreshId),
            ]);
            expect(retry.status).toBe(201);
        });

        it('the access token names its session (sid) and refresh keeps it', async () => {
            checkCredentials.mockResolvedValue(SELLER);
            const login = await call('POST', '/auth/login', [], {
                username: 'cashier',
                password: 'password123',
            });
            const first = setCookies(login);
            const sidOf = (cookie: string) =>
                (
                    jwt.decode(
                        decodeURIComponent(cookie)
                            .slice(2)
                            .replace(/\.[^.]+$/, ''),
                    ) as { sid?: string }
                ).sid;

            const refreshed = await call('POST', '/auth/refresh', [
                `refresh=${first.refresh}`,
            ]);
            const second = setCookies(refreshed);

            expect(sidOf(first.jwt)).toBeDefined();
            expect(sidOf(second.jwt)).toBe(sidOf(first.jwt));
        });
    });

    describe('no username enumeration (#12)', () => {
        async function loginBody(user: unknown) {
            checkCredentials.mockResolvedValue(user);
            const res = await call('POST', '/auth/login', [], {
                username: 'cashier',
                password: 'password123',
            });
            const body = (await res.json()) as Record<string, unknown>;
            // Per request, not per outcome.
            delete body.timestamp;
            delete body.requestId;
            return { status: res.status, body };
        }

        it('answers a deactivated account exactly like a wrong password', async () => {
            const wrong = await loginBody(null);
            const deactivated = await loginBody({ ...SELLER, isActive: false });

            expect(wrong.status).toBe(401);
            expect(deactivated).toEqual(wrong);
            expect(wrong.body).toMatchObject({
                error: ErrorCode.AUTH_INVALID_CREDENTIALS,
                message: INVALID_CREDENTIALS_MESSAGE,
            });
            expect(model.rows.size).toBe(0);
        });
    });

    describe('rate limiting (#12)', () => {
        const login = (username: string) =>
            call('POST', '/auth/login', [], { username, password: 'nope' });

        beforeEach(() => checkCredentials.mockResolvedValue(null));

        it(`login: ${RATE_LIMITS.login.account.limit} tries per username and IP, then 429`, async () => {
            for (let i = 0; i < RATE_LIMITS.login.account.limit; i++) {
                expect((await login('cashier')).status).toBe(401);
            }

            const blocked = await login(' Cashier ');

            expect(blocked.status).toBe(429);
            expect(await blocked.json()).toMatchObject({
                statusCode: 429,
                error: ErrorCode.RATE_LIMITED,
                path: '/v1/auth/login',
                details: { retryAfterS: expect.any(Number) },
            });
            expect(Number(blocked.headers.get('retry-after-account'))).toBe(
                RATE_LIMITS.login.account.ttl / 1000,
            );
            // Not checked at all once blocked.
            expect(checkCredentials).toHaveBeenCalledTimes(
                RATE_LIMITS.login.account.limit,
            );
            // Another username from the same IP still has its own budget.
            expect((await login('manager')).status).toBe(401);
        });

        it('login: case and whitespace variants of a username share its bucket', async () => {
            // Each of these reaches checkCredentials as plain `admin` after
            // LoginDto's trim + lowercase, so each must count against `admin`.
            const variants = [
                'admin',
                ' ADMIN ',
                'Admin',
                '\tadmin\n',
                'ADMIN',
            ];
            for (const variant of variants) {
                expect((await login(variant)).status).toBe(401);
            }
            expect(
                checkCredentials.mock.calls.map(([name]) => name as string),
            ).toEqual(variants.map(() => 'admin'));

            const blocked = await login('  aDmIn');

            expect(blocked.status).toBe(429);
            expect(blocked.headers.get('retry-after')).toBe(
                String(RATE_LIMITS.login.account.ttl / 1000),
            );
        });

        it('login: markup in a username is kept as typed, so it names another account (#15)', async () => {
            // Nothing strips tags or decodes entities any more: these are
            // not `admin` and cannot sign in as it, so they get their own
            // buckets and `admin` keeps its full budget.
            const variants = ['<b>admin</b>', 'a&#100;min', 'M&M'];
            for (const variant of variants) {
                expect((await login(variant)).status).toBe(401);
            }
            expect(
                checkCredentials.mock.calls.map(([name]) => name as string),
            ).toEqual(['<b>admin</b>', 'a&#100;min', 'm&m']);
        });

        it(`login: ${RATE_LIMITS.login.ip.limit} tries per IP across usernames, then 429`, async () => {
            for (let i = 0; i < RATE_LIMITS.login.ip.limit; i++) {
                expect((await login(`user${i}`)).status).toBe(401);
            }

            const blocked = await login('fresh-name');

            expect(blocked.status).toBe(429);
            expect(blocked.headers.get('retry-after-ip')).toBeTruthy();
        });

        it(`refresh: ${RATE_LIMITS.refresh.ip.limit} per IP, then 429`, async () => {
            for (let i = 0; i < RATE_LIMITS.refresh.ip.limit; i++) {
                expect((await call('POST', '/auth/refresh')).status).toBe(401);
            }

            const blocked = await call('POST', '/auth/refresh');

            expect(blocked.status).toBe(429);
            expect(await blocked.json()).toMatchObject({
                error: ErrorCode.RATE_LIMITED,
            });
        });

        it('logout is not rate limited', async () => {
            for (let i = 0; i < RATE_LIMITS.refresh.ip.limit + 1; i++) {
                expect((await call('POST', '/auth/logout')).status).toBe(201);
            }
        });
    });
});
