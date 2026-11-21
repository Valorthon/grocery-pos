/**
 * The API itself refuses a SELLER-only user on every route a SELLER may
 * not use (#427), through the real AppModule in the single-pc edition.
 *
 * The routes come from the served controllers' metadata (`app-routes.ts`)
 * and are cross-checked against contracts `PERMISSIONS`, so a new route is
 * covered without editing this file. A SELLER logs in over HTTP at the
 * proxy origin and calls each one with the right `x-wire-version`: every
 * answer is 403. Without the header the same call is 409 CLIENT_OUTDATED
 * first, which is what a bare console `fetch` saw in the Windows E2E test.
 */
import { request } from 'node:http';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import * as argon from 'argon2';
import {
    ErrorCode,
    PERMISSIONS,
    Role,
    WIRE_VERSION,
    WIRE_VERSION_HEADER,
} from '@grocery-pos/contracts';
import type { DbApp } from './db-app';

Object.assign(process.env, {
    APP_ENV: 'single-pc',
    FRONTEND_URL: 'https://localhost:1443',
    DOMAIN: '',
    COOKIE_SECRET: 'Q8wN2eR5tY1uI4oP7aS0dF3gH6jK9lZ2xC5vB8nM1qW4eR7tY0uI3oP6',
    JWT_SECRET: 'k3Jf9Qv2Lx8Zr1Tn6Wb4Yh7Pc0Md5Ea2Gs9Uq3Io8Rl1Vx6Nz4Ky7Bt0Hw5',
});

const ORIGIN = 'https://localhost:1443';
const HEADERS = {
    host: 'localhost:1443',
    origin: ORIGIN,
    [WIRE_VERSION_HEADER]: String(WIRE_VERSION),
};
const PASSWORD = 'seller-pass-427';
const FAKE_ID = '0123456789abcdef01234567';

interface SellerRefusedRoute {
    method: string;
    key: string;
    path: string;
}

/** Every non-public route whose effective `@Roles` leave SELLER out. */
function refusedRoutes(): SellerRefusedRoute[] {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { appControllers, handlersOf } =
        require('../../src/common/testing/app-routes') as typeof import('../../src/common/testing/app-routes');
    const { IS_PUBLIC_KEY, ROLES_KEY } =
        require('../../src/auth/auth.decorator') as typeof import('../../src/auth/auth.decorator');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const reflector = new Reflector();
    const join = (...parts: Array<string | undefined>) =>
        `/${parts
            .map((p) => (p ?? '').replace(/^\/+|\/+$/g, ''))
            .filter(Boolean)
            .join('/')}`;
    return appControllers().flatMap((controller) => {
        const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
        return handlersOf(controller).flatMap(([, handler]) => {
            const targets = [handler, controller];
            if (reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets))
                return [];
            const roles =
                reflector.getAllAndOverride<Role[] | undefined>(
                    ROLES_KEY,
                    targets,
                ) ?? [];
            if (roles.includes(Role.Seller)) return [];
            const method =
                RequestMethod[
                    Reflect.getMetadata(METHOD_METADATA, handler) as number
                ];
            const route = join(
                base,
                Reflect.getMetadata(PATH_METADATA, handler) as string,
            );
            return [
                {
                    method,
                    key: `${method} ${route}`,
                    path: route.replace(/:[^/]+/g, FAKE_ID),
                },
            ];
        });
    });
}

let db: DbApp;
let base: string;
let routes: SellerRefusedRoute[];
let cookie: string;

interface Reply {
    status: number;
    setCookie: string[];
    body: string;
}

function send(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: unknown,
): Promise<Reply> {
    const url = new URL(`${base}${path}`);
    // No body on DELETE: node:http sends it unframed there (no chunking).
    const payload =
        method === 'GET' || method === 'HEAD' || method === 'DELETE'
            ? undefined
            : JSON.stringify(body ?? {});
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

beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { bootDbApp } = require('./db-app') as typeof import('./db-app');
    db = await bootDbApp();
    base = `${(await db.app.getUrl()).replace('[::1]', '127.0.0.1')}/v1`;
    routes = refusedRoutes();
    await db.model('User').create({
        name: 'cashier',
        roles: [Role.Seller],
        passwordHash: await argon.hash(PASSWORD),
        isActive: true,
    });
    const res = await send('POST', '/auth/login', HEADERS, {
        username: 'cashier',
        password: PASSWORD,
    });
    expect(res.status).toBeLessThan(300);
    cookie = res.setCookie
        .map((line) => line.split(';')[0])
        .filter((pair) => pair.startsWith('jwt='))
        .join('; ');
    expect(cookie).toMatch(/^jwt=/);
});
afterAll(async () => {
    await db?.close();
});

it('finds the non-SELLER routes and PERMISSIONS agrees with them', () => {
    expect(routes.length).toBeGreaterThan(40);
    const keys = new Set(routes.map((r) => r.key));
    for (const key of [
        'GET /users',
        'GET /audit',
        'PATCH /settings',
        'POST /shifts/:id/close',
        'GET /suppliers',
    ]) {
        expect(keys).toContain(key);
    }
    const sellerRoutes = new Set(
        PERMISSIONS.filter((p) => p.roles.includes(Role.Seller)).flatMap(
            (p) => p.routes,
        ),
    );
    expect(routes.filter((r) => sellerRoutes.has(r.key))).toEqual([]);
});

it('refuses every non-SELLER route with 403, never 2xx', async () => {
    const results = [];
    for (const route of routes) {
        const res = await send(route.method, route.path, {
            ...HEADERS,
            cookie,
        });
        results.push({ key: route.key, status: res.status });
    }
    expect(results.filter((r) => r.status !== 403)).toEqual([]);
});

it('answers 409 CLIENT_OUTDATED first without the wire-version header', async () => {
    const { [WIRE_VERSION_HEADER]: _omit, ...bare } = HEADERS;
    void _omit;
    const res = await send('GET', '/users', { ...bare, cookie });
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body)).toMatchObject({
        error: ErrorCode.CLIENT_OUTDATED,
    });
    const withHeader = await send('GET', '/users', { ...HEADERS, cookie });
    expect(withHeader.status).toBe(403);
});
