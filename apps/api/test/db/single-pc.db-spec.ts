/**
 * The single-pc edition's local access (#358) through the real AppModule:
 * a real login, refresh rotation and logout at the proxy's origin
 * (`https://localhost:1443`) set and clear Secure, host-only, Lax cookies,
 * and a foreign Host or Origin is refused with the usual error body.
 *
 * The env is switched to single-pc before the app is imported (setup-env.ts
 * set `test`), so AppModule's ConfigModule validates the single-pc rules.
 */
import { request } from 'node:http';
import * as argon from 'argon2';
import {
    AuditAction,
    ErrorCode,
    Role,
    WIRE_VERSION,
    WIRE_VERSION_HEADER,
} from '@grocery-pos/contracts';
import type { DbApp } from './db-app';

Object.assign(process.env, {
    APP_ENV: 'single-pc',
    FRONTEND_URL: 'https://localhost:1443',
    LAN_ORIGIN: 'https://192.168.1.10:1443',
    DOMAIN: '',
    // Strict secrets apply: distinct, non-placeholder values.
    COOKIE_SECRET: 'Q8wN2eR5tY1uI4oP7aS0dF3gH6jK9lZ2xC5vB8nM1qW4eR7tY0uI3oP6',
    JWT_SECRET: 'k3Jf9Qv2Lx8Zr1Tn6Wb4Yh7Pc0Md5Ea2Gs9Uq3Io8Rl1Vx6Nz4Ky7Bt0Hw5',
});

const ORIGIN = 'https://localhost:1443';
const PROXY_HEADERS = {
    host: 'localhost:1443',
    origin: ORIGIN,
    [WIRE_VERSION_HEADER]: String(WIRE_VERSION),
};
const LAN_ORIGIN = 'https://192.168.1.10:1443';
const LAN_HEADERS = {
    host: '192.168.1.10:1443',
    origin: LAN_ORIGIN,
    [WIRE_VERSION_HEADER]: String(WIRE_VERSION),
};
const PASSWORD = 'single-pc-pass-358';

let db: DbApp;
let base: string;

beforeAll(async () => {
    // Loaded only now, after the env switch above (a static import would be
    // hoisted above it).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { bootDbApp } = require('./db-app') as typeof import('./db-app');
    db = await bootDbApp();
    base = `${(await db.app.getUrl()).replace('[::1]', '127.0.0.1')}/v1`;
    await db.model('User').create({
        name: 'owner',
        roles: [Role.Admin],
        passwordHash: await argon.hash(PASSWORD),
        isActive: true,
    });
});
afterAll(async () => {
    await db?.close();
});

interface Reply {
    status: number;
    setCookie: string[];
    body: string;
}

/**
 * node:http rather than fetch, which drops a caller's Host header: the
 * proxy forwards the browser's Host, and that is what the API checks.
 */
function send(
    method: 'GET' | 'POST',
    path: string,
    headers: Record<string, string>,
    body?: unknown,
): Promise<Reply> {
    const url = new URL(`${base}${path}`);
    // A string is sent as is (malformed JSON included).
    const payload =
        body === undefined
            ? undefined
            : typeof body === 'string'
              ? body
              : JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = request(
            {
                method,
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                headers: {
                    ...(payload ? { 'content-type': 'application/json' } : {}),
                    ...headers,
                },
            },
            (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', (chunk: string) => (text += chunk));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode ?? 0,
                        setCookie: res.headers['set-cookie'] ?? [],
                        body: text,
                    }),
                );
            },
        );
        req.on('error', reject);
        req.end(payload);
    });
}

const post = (
    path: string,
    headers: Record<string, string>,
    body: unknown = {},
) => send('POST', path, headers, body);

/** Set-Cookie lines by cookie name (the last one wins). */
function setCookies(res: Reply): Map<string, string> {
    const byName = new Map<string, string>();
    for (const line of res.setCookie) {
        byName.set(line.slice(0, line.indexOf('=')), line);
    }
    return byName;
}

function cookieHeader(lines: Map<string, string>): string {
    return [...lines.values()]
        .filter((line) => !/Expires=Thu, 01 Jan 1970/i.test(line))
        .map((line) => line.split(';')[0])
        .join('; ');
}

function expectLocalCookie(line: string | undefined): void {
    expect(line).toBeDefined();
    expect(line).toMatch(/;\s*Secure/i);
    expect(line).toMatch(/;\s*SameSite=Lax/i);
    expect(line).not.toMatch(/;\s*Domain=/i);
}

const login = () =>
    post('/auth/login', PROXY_HEADERS, {
        username: 'owner',
        password: PASSWORD,
    });

it('logs in, rotates and logs out with Secure host-only Lax cookies', async () => {
    const loggedIn = await login();
    expect(loggedIn.status).toBeLessThan(300);
    const issued = setCookies(loggedIn);
    for (const name of ['jwt', 'refresh', 'dummy']) {
        expectLocalCookie(issued.get(name));
    }
    expect(issued.get('dummy')).not.toMatch(/HttpOnly/i);

    const refreshed = await post('/auth/refresh', {
        ...PROXY_HEADERS,
        cookie: cookieHeader(issued),
    });
    expect(refreshed.status).toBeLessThan(300);
    const rotated = setCookies(refreshed);
    expectLocalCookie(rotated.get('refresh'));
    expectLocalCookie(rotated.get('dummy'));

    const loggedOut = await post('/auth/logout', {
        ...PROXY_HEADERS,
        cookie: cookieHeader(new Map([...issued, ...rotated])),
    });
    expect(loggedOut.status).toBeLessThan(300);
    const cleared = setCookies(loggedOut);
    for (const name of ['jwt', 'refresh', 'dummy']) {
        const line = cleared.get(name);
        expectLocalCookie(line);
        expect(line).toMatch(/Expires=Thu, 01 Jan 1970/i);
    }
});

it.each([
    ['a direct call naming the API port', { host: '127.0.0.1:13000' }],
    ['a DNS-rebinding host', { host: 'attacker.example:1443', origin: ORIGIN }],
    [
        'another local origin',
        { host: 'localhost:1443', origin: 'http://localhost:1443' },
    ],
    [
        'a foreign site',
        { host: 'localhost:1443', origin: 'https://attacker.example' },
    ],
])('refuses %s with a 403 error body', async (_label, headers) => {
    const res = await post('/auth/login', headers, {
        username: 'owner',
        password: PASSWORD,
    });
    expect(res.status).toBe(403);
    expect(res.setCookie).toEqual([]);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toMatchObject({
        statusCode: 403,
        error: ErrorCode.FORBIDDEN,
        path: '/v1/auth/login',
    });
    expect(typeof body.requestId).toBe('string');
});

it.each([
    [
        'the LAN host with the localhost Origin',
        { ...LAN_HEADERS, origin: ORIGIN },
    ],
    [
        'the localhost host with the LAN Origin',
        { ...PROXY_HEADERS, origin: LAN_ORIGIN },
    ],
    [
        'an unlisted private IP',
        {
            ...LAN_HEADERS,
            host: '192.168.1.11:1443',
            origin: 'https://192.168.1.11:1443',
        },
    ],
])('refuses %s (#394)', async (_label, headers) => {
    const res = await post('/auth/login', headers, {
        username: 'owner',
        password: 'not-the-password',
    });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: ErrorCode.FORBIDDEN });
});

it('accepts the fixed LAN origin on its own host (#394)', async () => {
    // Wrong credentials reach the login handler: its generic 401.
    const res = await post('/auth/login', LAN_HEADERS, {
        username: 'owner',
        password: 'not-the-password',
    });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({
        error: ErrorCode.AUTH_INVALID_CREDENTIALS,
    });
});

it.each(['192.168.1.10:1443', '192.168.1.10', 'attacker.example'])(
    'refuses health probes naming %s (#394)',
    async (host) => {
        const res = await send('GET', '/health/live', { host });
        expect(res.status).toBe(403);
    },
);

it('accepts a same-origin request without an Origin header', async () => {
    // Wrong credentials reach the login handler: its generic 401, not
    // the access check's 403.
    const res = await post(
        '/auth/login',
        {
            host: 'localhost:1443',
            [WIRE_VERSION_HEADER]: String(WIRE_VERSION),
        },
        { username: 'owner', password: 'not-the-password' },
    );
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({
        error: ErrorCode.AUTH_INVALID_CREDENTIALS,
    });
});

it('refuses a stale or unversioned client with 409 before parsing its body (#364)', async () => {
    for (const version of [undefined, String(WIRE_VERSION + 1)]) {
        const res = await post(
            '/offline/sync',
            {
                host: 'localhost:1443',
                origin: ORIGIN,
                ...(version ? { [WIRE_VERSION_HEADER]: version } : {}),
            },
            '{"not json',
        );
        expect(res.status).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({
            error: ErrorCode.CLIENT_OUTDATED,
        });
    }
});

it('takes a same-origin CSP report through the proxy host', async () => {
    const res = await send(
        'POST',
        '/csp-report',
        // The browser's report carries none of our headers.
        {
            host: 'localhost:1443',
            origin: ORIGIN,
            'content-type': 'application/csp-report',
        },
        {
            'csp-report': {
                'document-uri': `${ORIGIN}/sell`,
                'violated-directive': 'script-src',
                'blocked-uri': 'inline',
            },
        },
    );
    expect(res.status).toBe(204);
});

it('refuses a foreign request before parsing its body', async () => {
    // Parsed first, this would be a 400 body-parser error.
    const res = await post(
        '/auth/login',
        { host: 'localhost:1443', origin: 'https://evil.example' },
        '{"username": ',
    );
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: ErrorCode.FORBIDDEN });
});

it('answers health probes on the API port directly, and nothing else', async () => {
    const direct = { host: '127.0.0.1:13000' };
    const live = await send('GET', '/health/live', direct);
    // The handler answered: 200, or 503 if the heap check trips late in
    // the in-band run. Either way a terminus body, never the 403.
    expect([200, 503]).toContain(live.status);
    expect(JSON.parse(live.body)).toHaveProperty('status');

    const other = await send('GET', '/settings/today', direct);
    expect(other.status).toBe(403);
});

/** What Caddy forwards for a LAN terminal (#395): its peer address. */
const fromTerminal = (ip: string) => ({
    ...LAN_HEADERS,
    'x-forwarded-for': ip,
});

const badLogin = (headers: Record<string, string>, username: string) =>
    post('/auth/login', headers, { username, password: 'wrong-password-1' });

it('gives each LAN terminal its own login lockout (#395)', async () => {
    const a = fromTerminal('192.168.1.20');
    const b = fromTerminal('192.168.1.21');
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
        statuses.push((await badLogin(a, 'cashier1')).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
    // Same account, another terminal: not locked out.
    expect((await badLogin(b, 'cashier1')).status).toBe(401);
});

it('gives each LAN terminal its own manager PIN lockout (#395)', async () => {
    // A login on a third address, so no login bucket is shared.
    const loggedIn = await post('/auth/login', fromTerminal('192.168.1.30'), {
        username: 'owner',
        password: PASSWORD,
    });
    expect(loggedIn.status).toBeLessThan(300);
    const cookie = cookieHeader(setCookies(loggedIn));
    const approve = (ip: string) =>
        post(
            '/auth/override',
            { ...fromTerminal(ip), cookie },
            {
                username: 'nobody',
                pin: '000000',
                action: 'STOCK_COUNT',
                context: {
                    stockCount: {
                        countId: '0123456789abcdef01234567',
                        version: 0,
                    },
                },
            },
        );
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
        statuses.push((await approve('192.168.1.22')).status);
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
    expect(statuses[5]).toBe(429);
    expect((await approve('192.168.1.23')).status).not.toBe(429);
});

it('ignores a forged X-Forwarded-For entry before the real peer (#395)', async () => {
    // Caddy replaces a client-sent header (no trusted_proxies); were one
    // ever passed along, only the hop Caddy added (the rightmost) counts.
    // Guards against `trust proxy = true`, which would take the leftmost
    // (forged) entry and give every forged address a fresh bucket.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
        const res = await badLogin(
            {
                ...LAN_HEADERS,
                'x-forwarded-for': `203.0.113.${i + 1}, 192.168.1.24`,
            },
            'cashier2',
        );
        statuses.push(res.status);
    }
    // One terminal, one account bucket, whatever address was forged.
    expect(statuses[5]).toBe(429);
});

it('records the LAN terminal address in the audit log (#395)', async () => {
    await badLogin(fromTerminal('192.168.1.25'), 'audited');
    const entry = await db
        .model('AuditLog')
        .findOne({ action: AuditAction.AUTH_LOGIN_FAILED })
        .where({ ip: '192.168.1.25' })
        .lean<{ ip: string | null } | null>();
    expect(entry?.ip).toBe('192.168.1.25');
});

it('counts the main PC over ::1 or 127.0.0.1 as one client, audited as 127.0.0.1', async () => {
    // Caddy forwards ::1 when the main PC's browser connects over [::1].
    const v6 = { ...PROXY_HEADERS, 'x-forwarded-for': '::1' };
    const v4 = { ...PROXY_HEADERS, 'x-forwarded-for': '127.0.0.1' };
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++)
        statuses.push((await badLogin(v6, 'mainpc')).status);
    for (let i = 0; i < 3; i++)
        statuses.push((await badLogin(v4, 'mainpc')).status);
    // One account bucket across both: the sixth try is refused.
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);

    const entries = await db
        .model('AuditLog')
        .find({ action: AuditAction.AUTH_LOGIN_FAILED, 'after.name': 'mainpc' })
        .lean<{ ip: string | null }[]>();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry.ip).toBe('127.0.0.1');
});
