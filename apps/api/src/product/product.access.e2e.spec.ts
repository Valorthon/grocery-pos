/**
 * Per-role access to every product route, over real HTTP (issue #6).
 *
 * Boots the real ProductController behind the real global JWTAuthGuard,
 * RoleGuard and GlobalFilter, with cookie-parser, URI versioning and the
 * ValidationPipe configured as in main.ts. Only ProductService is faked, so
 * what is under test is which roles reach each handler. Mirrors the harness
 * in auth/auth.e2e.spec.ts.
 */
import { createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';
import {
    INestApplication,
    ValidationPipe,
    VersioningType,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Types } from 'mongoose';
import { STRING_LIMITS } from '../constants';
import { JWTAuthGuard } from '../auth/guards/jwt.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { JWTStrategy } from '../auth/jwt.strategy';
import { Role } from '../auth/types';
import { GlobalFilter } from '../common/global/global.filter';
import { ErrorCode } from '../common/errors';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';

const COOKIE_SECRET = 'product-access-cookie-secret-0123456789';
const JWT_SECRET = 'product-access-jwt-secret-0123456789abc';

const CONFIG: Record<string, unknown> = {
    NODE_ENV: 'test',
    COOKIE_SECRET,
    JWT_SECRET,
};

const EAN = '2000000000015';

type Method = 'GET' | 'PATCH' | 'POST';

interface Route {
    label: string;
    method: Method;
    path: string;
    body?: unknown;
    allowed: Role[];
}

/** The access matrix documented on ProductController. */
const ROUTES: Route[] = [
    {
        label: 'GET /products/matches',
        method: 'GET',
        path: '/products/matches?name=milk',
        allowed: [Role.Restocker, Role.Adjuster, Role.Seller],
    },
    {
        label: 'GET /products/ensureValid',
        method: 'GET',
        path: `/products/ensureValid?EAN=${EAN}&name=milk`,
        allowed: [Role.Restocker, Role.Adjuster],
    },
    {
        label: 'GET /products/:EAN',
        method: 'GET',
        path: `/products/${EAN}`,
        allowed: [Role.Restocker, Role.Adjuster, Role.Seller],
    },
    {
        label: 'PATCH /products (no price)',
        method: 'PATCH',
        path: '/products',
        body: {
            updates: [
                {
                    product: new Types.ObjectId().toString(),
                    update: { name: 'milk' },
                },
            ],
        },
        allowed: [Role.Restocker, Role.Adjuster],
    },
    {
        // Price changes are Admin only (issue #13).
        label: 'PATCH /products (with price)',
        method: 'PATCH',
        path: '/products',
        body: {
            updates: [
                {
                    product: new Types.ObjectId().toString(),
                    update: { name: 'milk' },
                },
                {
                    product: new Types.ObjectId().toString(),
                    update: { price: 1999 },
                },
            ],
        },
        allowed: [],
    },
    {
        label: 'GET /products',
        method: 'GET',
        path: '/products?page=1&limit=10',
        allowed: [Role.Restocker, Role.Adjuster],
    },
    {
        label: 'POST /products/bulk',
        method: 'POST',
        path: '/products/bulk',
        body: { newProducts: [{ name: 'milk', price: 1999 }] },
        allowed: [Role.Restocker, Role.Adjuster],
    },
];

const ROLES = [
    Role.Seller,
    Role.Restocker,
    Role.Adjuster,
    Role.UserManager,
    Role.Admin,
];

/** cookie-parser's signed format: `s:<value>.<base64 HMAC-SHA256>`. */
function signCookie(value: string): string {
    const mac = createHmac('sha256', COOKIE_SECRET)
        .update(value)
        .digest('base64')
        .replace(/=+$/, '');
    return encodeURIComponent(`s:${value}.${mac}`);
}

describe('Product route access by role (e2e)', () => {
    let app: INestApplication;
    let base: string;
    let jwt: JwtService;

    // PATCH runs the real ProductService.update, so its price rule is under
    // test too; only the database behind it is faked.
    const updateOne = jest.fn().mockResolvedValue(undefined);
    const realUpdate = ProductService.prototype.update.bind({
        connection: {
            startSession: () =>
                Promise.resolve({
                    withTransaction: async (fn: (s: unknown) => unknown) =>
                        fn({}),
                    endSession: () => undefined,
                }),
        },
        model: { updateOne },
    } as unknown as ProductService);

    const service = {
        getMatches: jest.fn().mockResolvedValue([]),
        ensureValid: jest.fn().mockResolvedValue(undefined),
        getByBarcode: jest.fn().mockResolvedValue({ EAN }),
        update: jest.fn(realUpdate),
        getAll: jest.fn().mockResolvedValue({ data: [], totalItems: 0 }),
        addMany: jest.fn().mockResolvedValue(undefined),
    };

    function tokenFor(roles: Role[]): string {
        return `jwt=${signCookie(
            jwt.sign(
                {
                    userId: new Types.ObjectId().toString(),
                    username: 'user',
                    roles,
                },
                { secret: JWT_SECRET, expiresIn: 600 },
            ),
        )}`;
    }

    function call(route: Route, roles: Role[]): Promise<Response> {
        return fetch(`${base}${route.path}`, {
            method: route.method,
            headers: {
                cookie: tokenFor(roles),
                'content-type': 'application/json',
            },
            body:
                route.body === undefined
                    ? undefined
                    : JSON.stringify(route.body),
        });
    }

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [JwtModule.register({})],
            controllers: [ProductController],
            providers: [
                JWTStrategy,
                { provide: ProductService, useValue: service },
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
        app.useGlobalPipes(
            new ValidationPipe({
                transform: true,
                whitelist: true,
                forbidNonWhitelisted: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        );
        app.use(cookieParser(COOKIE_SECRET));
        app.enableVersioning({ defaultVersion: '1', type: VersioningType.URI });
        await app.listen(0, '127.0.0.1');

        const { port } = app.getHttpServer().address() as AddressInfo;
        base = `http://127.0.0.1:${port}/v1`;
        jwt = app.get(JwtService);
    });

    afterAll(async () => {
        await app.close();
    });

    const cases = ROUTES.flatMap((route) =>
        ROLES.map((role) => {
            const ok = role === Role.Admin || route.allowed.includes(role);
            return [route.label, role, ok, route] as const;
        }),
    );

    it.each(cases)('%s as %s -> allowed: %s', async (_l, role, ok, route) => {
        const res = await call(route, [role]);

        if (ok) {
            expect(res.status).toBeLessThan(300);
        } else {
            expect(res.status).toBe(403);
        }
    });

    it('lets a Seller-only cashier search and read the matches', async () => {
        const match = { EAN, name: 'milk', product: 'p1' };
        service.getMatches.mockResolvedValueOnce([match]);

        const res = await call(ROUTES[0], [Role.Seller]);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([match]);
    });

    it('denies a Seller price edits and product creation', async () => {
        const patch = ROUTES.find(
            (r) => r.label === 'PATCH /products (with price)',
        )!;
        const create = ROUTES.find((r) => r.label === 'POST /products/bulk')!;
        service.update.mockClear();
        service.addMany.mockClear();

        expect((await call(patch, [Role.Seller])).status).toBe(403);
        expect((await call(create, [Role.Seller])).status).toBe(403);
        expect(service.update).not.toHaveBeenCalled();
        expect(service.addMany).not.toHaveBeenCalled();
    });

    describe('price changes are Admin only (issue #13)', () => {
        const withPrice = ROUTES.find(
            (r) => r.label === 'PATCH /products (with price)',
        )!;
        const withoutPrice = ROUTES.find(
            (r) => r.label === 'PATCH /products (no price)',
        )!;

        beforeEach(() => updateOne.mockClear());

        it.each([Role.Restocker, Role.Adjuster])(
            'refuses a %s batch that sets a price, writing nothing',
            async (role) => {
                const res = await call(withPrice, [role]);

                expect(res.status).toBe(403);
                expect(await res.json()).toMatchObject({
                    error: ErrorCode.PRODUCT_PRICE_CHANGE_FORBIDDEN,
                });
                // The name edit in the same batch is not applied either.
                expect(updateOne).not.toHaveBeenCalled();
            },
        );

        it('lets a Restocker edit non-price fields', async () => {
            const res = await call(withoutPrice, [Role.Restocker]);

            expect(res.status).toBe(200);
            expect(updateOne).toHaveBeenCalledTimes(1);
        });

        it('lets an Admin change prices', async () => {
            const res = await call(withPrice, [Role.Admin]);

            expect(res.status).toBe(200);
            expect(updateOne).toHaveBeenCalledWith(
                expect.anything(),
                { $set: { price: 1999 } },
                expect.anything(),
            );
        });
    });

    it('answers an over-long search with 400, not a 500', async () => {
        const name = 'x'.repeat(STRING_LIMITS.PRODUCT_NAME + 1);

        const res = await call(
            { ...ROUTES[0], path: `/products/matches?name=${name}` },
            [Role.Seller],
        );

        expect(res.status).toBe(400);
    });
});
