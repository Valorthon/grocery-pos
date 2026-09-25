/**
 * Per-role access to every product route, over real HTTP (issue #6).
 *
 * Boots the real ProductController on the shared access harness
 * (common/testing/access-harness.ts): the real global JWTAuthGuard,
 * RoleGuard and GlobalFilter, with cookie-parser, URI versioning and the
 * ValidationPipe configured as in main.ts. ProductService is faked except
 * for `update`, so what is under test is which roles reach each handler
 * and the price rule behind PATCH.
 */
import { Types } from 'mongoose';
import { STRING_LIMITS } from '../constants';
import { Role } from '../auth/types';
import { ErrorCode } from '../common/errors';
import {
    AccessHarness,
    ALL_ROLES,
    bootAccessHarness,
    caller,
} from '../common/testing/access-harness';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';

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

describe('Product route access by role (e2e)', () => {
    let harness: AccessHarness;

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

    function call(route: Route, roles: Role[]): Promise<Response> {
        return harness.call(
            caller(...roles),
            route.method,
            route.path,
            route.body,
        );
    }

    beforeAll(async () => {
        harness = await bootAccessHarness(
            [ProductController],
            [{ provide: ProductService, useValue: service }],
        );
    });

    afterAll(async () => {
        await harness.close();
    });

    const cases = ROUTES.flatMap((route) =>
        ALL_ROLES.map((role) => {
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

    describe('names are stored as typed (#15)', () => {
        it('passes a 50-character name with &, < and > to the service unchanged', async () => {
            const name = `m&m's <3 a>b `
                .repeat(4)
                .slice(0, STRING_LIMITS.PRODUCT_NAME - 1)
                .concat('x');
            expect(name).toHaveLength(STRING_LIMITS.PRODUCT_NAME);
            service.addMany.mockClear();

            const res = await harness.call(
                caller(Role.Restocker),
                'POST',
                '/products/bulk',
                {
                    newProducts: [
                        { name: `  ${name.toUpperCase()} `, price: 1 },
                    ],
                },
            );

            expect(res.status).toBe(201);
            expect(service.addMany).toHaveBeenCalledWith(expect.anything(), {
                newProducts: [{ name, price: 1 }],
            });
        });

        it('searches for the text as typed', async () => {
            service.getMatches.mockClear();

            const res = await harness.call(
                caller(Role.Seller),
                'GET',
                `/products/matches?name=${encodeURIComponent('M&M')}`,
            );

            expect(res.status).toBe(200);
            expect(service.getMatches).toHaveBeenCalledWith({ name: 'm&m' });
        });
    });

    describe('write validation (issue #14)', () => {
        it.each([
            ['letters', 'abc'],
            ['a bad check digit', '4006381333932'],
            ['a code in the generated range', '2000000000015'],
        ])(
            'refuses a new product whose barcode has %s',
            async (_label, badEAN) => {
                service.addMany.mockClear();

                const res = await harness.call(
                    caller(Role.Restocker),
                    'POST',
                    '/products/bulk',
                    { newProducts: [{ name: 'milk', price: 1, EAN: badEAN }] },
                );

                expect(res.status).toBe(400);
                expect(service.addMany).not.toHaveBeenCalled();
            },
        );

        it('accepts a UPC-A as scanned', async () => {
            service.addMany.mockClear();

            const res = await harness.call(
                caller(Role.Restocker),
                'POST',
                '/products/bulk',
                {
                    newProducts: [
                        { name: 'milk', price: 1, EAN: '036000291452' },
                    ],
                },
            );

            expect(res.status).toBe(201);
            expect(service.addMany).toHaveBeenCalledWith(expect.anything(), {
                newProducts: [{ name: 'milk', price: 1, EAN: '036000291452' }],
            });
        });

        it.each([Role.Restocker, Role.Admin])(
            'refuses a line with no update object as %s: 400, not a 500, and no write',
            async (role) => {
                updateOne.mockClear();

                const res = await harness.call(
                    caller(role),
                    'PATCH',
                    '/products',
                    {
                        updates: [{ product: new Types.ObjectId().toString() }],
                    },
                );

                expect(res.status).toBe(400);
                expect(await res.json()).toMatchObject({
                    error: ErrorCode.VALIDATION_INVALID_INPUT,
                });
                expect(updateOne).not.toHaveBeenCalled();
            },
        );

        it('refuses an empty update with a 400 instead of writing $set: {}', async () => {
            updateOne.mockClear();

            const res = await harness.call(
                caller(Role.Admin),
                'PATCH',
                '/products',
                {
                    updates: [
                        {
                            product: new Types.ObjectId().toString(),
                            update: {},
                        },
                    ],
                },
            );

            expect(res.status).toBe(400);
            expect(await res.json()).toMatchObject({
                error: ErrorCode.VALIDATION_INVALID_INPUT,
            });
            expect(updateOne).not.toHaveBeenCalled();
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
