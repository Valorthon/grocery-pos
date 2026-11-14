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
import { ErrorCode, Role } from '@grocery-pos/contracts';
import type { DbApp } from './db-app';

Object.assign(process.env, {
    APP_ENV: 'single-pc',
    FRONTEND_URL: 'https://localhost:1443',
    DOMAIN: '',
    // Strict secrets apply: distinct, non-placeholder values.
    COOKIE_SECRET: 'Q8wN2eR5tY1uI4oP7aS0dF3gH6jK9lZ2xC5vB8nM1qW4eR7tY0uI3oP6',
    JWT_SECRET: 'k3Jf9Qv2Lx8Zr1Tn6Wb4Yh7Pc0Md5Ea2Gs9Uq3Io8Rl1Vx6Nz4Ky7Bt0Hw5',
});

const ORIGIN = 'https://localhost:1443';
const PROXY_HEADERS = { host: 'localhost:1443', origin: ORIGIN };
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
    const payload = body === undefined ? undefined : JSON.stringify(body);
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

it('accepts a same-origin request without an Origin header', async () => {
    // Wrong credentials reach the login handler: its generic 401, not
    // the access check's 403.
    const res = await post(
        '/auth/login',
        { host: 'localhost:1443' },
        { username: 'owner', password: 'not-the-password' },
    );
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({
        error: ErrorCode.AUTH_INVALID_CREDENTIALS,
    });
});

it('takes a same-origin CSP report through the proxy host', async () => {
    const res = await send(
        'POST',
        '/csp-report',
        { ...PROXY_HEADERS, 'content-type': 'application/csp-report' },
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
