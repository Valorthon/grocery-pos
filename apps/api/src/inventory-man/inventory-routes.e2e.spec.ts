/**
 * Every restock, adjustment and inventory route over real HTTP (issue #30):
 * who may call it, and what reaches the service. The real global
 * JWTAuthGuard, RoleGuard, GlobalFilter and ValidationPipe run; the
 * services are stubs, because their queries are unit-tested and their
 * database behaviour is in the DB suite (apps/api/test/db).
 *
 * Access (issue #13): restocks are RESTOCKER's, adjustments ADJUSTER's,
 * the inventory list both of theirs; ADMIN passes every check.
 */
import { Role } from '../auth/types';
import {
    AccessHarness,
    ALL_ROLES,
    bootAccessHarness,
    caller,
} from '../common/testing/access-harness';
import { ErrorCode, ValidationError } from '../common/errors';
import { AdjustmentController } from './adjustment/adjustment.controller';
import { AdjustmentService } from './adjustment/adjustment.service';
import { InventoryController } from './inventory/inventory.controller';
import { InventoryService } from './inventory/inventory.service';
import { RestockController } from './restock/restock.controller';
import { RestockService } from './restock/restock.service';

const ID = '507f1f77bcf86cd799439011';
const PAGE = { data: [{ _id: ID }], totalItems: 1 };
const USERS = [{ _id: ID, name: 'ana' }];

const restockService = {
    restock: jest.fn(),
    getAll: jest.fn(),
    getDetails: jest.fn(),
    getRestockUsers: jest.fn(),
};
const adjustmentService = {
    adjust: jest.fn(),
    getAll: jest.fn(),
    getDetails: jest.fn(),
    getAdjustUsers: jest.fn(),
};
const inventoryService = { getAll: jest.fn() };

let harness: AccessHarness;

beforeAll(async () => {
    harness = await bootAccessHarness(
        [RestockController, AdjustmentController, InventoryController],
        [
            { provide: RestockService, useValue: restockService },
            { provide: AdjustmentService, useValue: adjustmentService },
            { provide: InventoryService, useValue: inventoryService },
        ],
    );
});

afterAll(async () => {
    await harness.close();
});

beforeEach(() => {
    jest.resetAllMocks();
    for (const s of [restockService, adjustmentService, inventoryService]) {
        s.getAll.mockResolvedValue(PAGE);
    }
    restockService.getDetails.mockResolvedValue(PAGE);
    adjustmentService.getDetails.mockResolvedValue(PAGE);
    restockService.getRestockUsers.mockResolvedValue(USERS);
    adjustmentService.getAdjustUsers.mockResolvedValue(USERS);
});

const READ_ROUTES: { path: string; roles: Role[] }[] = [
    { path: '/restocks?page=1&limit=10', roles: [Role.Restocker] },
    {
        path: `/restocks/details/${ID}?page=1&limit=10`,
        roles: [Role.Restocker],
    },
    { path: '/restocks/users', roles: [Role.Restocker] },
    { path: '/adjustments?page=1&limit=10', roles: [Role.Adjuster] },
    {
        path: `/adjustments/details/${ID}?page=1&limit=10`,
        roles: [Role.Adjuster],
    },
    { path: '/adjustments/users', roles: [Role.Adjuster] },
    {
        path: '/inventories?page=1&limit=10',
        roles: [Role.Restocker, Role.Adjuster],
    },
];

describe.each(READ_ROUTES)('GET $path', ({ path, roles }) => {
    it.each(ALL_ROLES)('as %s', async (role) => {
        const allowed = role === Role.Admin || roles.includes(role);
        const res = await harness.call(caller(role), 'GET', path);
        expect(res.status).toBe(allowed ? 200 : 403);
    });
});

describe('restock and adjustment details routes', () => {
    it.each([
        ['restocks', restockService, 'restock'],
        ['adjustments', adjustmentService, 'adjustment'],
    ] as const)(
        'GET /%s/details/:id passes the id, the paging and the lowercased search on',
        async (base, service, param) => {
            const res = await harness.call(
                caller(Role.Admin),
                'GET',
                `/${base}/details/${ID}?page=2&limit=25&name=%20MILK%20&EAN=480`,
            );

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual(PAGE);
            expect(service.getDetails).toHaveBeenCalledWith({
                [param]: ID,
                page: 2,
                limit: 25,
                name: 'milk',
                EAN: '480',
            });
        },
    );

    it.each([
        ['restocks', restockService],
        ['adjustments', adjustmentService],
    ] as const)(
        'GET /%s/details/:id refuses a malformed id before the service',
        async (base, service) => {
            const res = await harness.call(
                caller(Role.Admin),
                'GET',
                `/${base}/details/not-an-id?page=1&limit=10`,
            );

            expect(res.status).toBe(400);
            expect(((await res.json()) as { error: string }).error).toBe(
                ErrorCode.VALIDATION_INVALID_INPUT,
            );
            expect(service.getDetails).not.toHaveBeenCalled();
        },
    );

    it.each(['restocks', 'adjustments'])(
        'GET /%s/details/:id caps limit at PAGINATION.LIMIT_MAX (#16)',
        async (base) => {
            const res = await harness.call(
                caller(Role.Admin),
                'GET',
                `/${base}/details/${ID}?page=1&limit=101`,
            );
            expect(res.status).toBe(400);
        },
    );
});

describe('user filter lists', () => {
    it.each([
        ['/restocks/users', Role.Restocker],
        ['/adjustments/users', Role.Adjuster],
    ])('GET %s returns the service list as is', async (path, role) => {
        const res = await harness.call(caller(role), 'GET', path);
        expect(await res.json()).toEqual(USERS);
    });
});

describe('write routes', () => {
    it('POST /restocks passes the caller as the restocker', async () => {
        const who = caller(Role.Restocker);
        const res = await harness.call(who, 'POST', '/restocks', {
            description: 'delivery',
            restockDetails: [{ product: ID, quantity: 1, unitCost: 100 }],
        });
        expect(res.status).toBe(201);
        expect(restockService.restock).toHaveBeenCalledWith(
            expect.objectContaining({ userId: who.userId }),
            expect.anything(),
        );
    });

    it('POST /adjustments passes the caller as the adjuster', async () => {
        const who = caller(Role.Adjuster);
        const res = await harness.call(who, 'POST', '/adjustments', {
            description: 'count',
            adjustDetails: [{ product: ID, change: -1, reason: 'broken' }],
        });
        expect(res.status).toBe(201);
        expect(adjustmentService.adjust).toHaveBeenCalledWith(
            expect.objectContaining({ userId: who.userId }),
            expect.anything(),
        );
    });

    it.each([
        ['/restocks', Role.Adjuster],
        ['/adjustments', Role.Restocker],
        ['/restocks', Role.Seller],
    ])(
        'POST %s is 403 for %s and never reaches the service',
        async (path, role) => {
            const res = await harness.call(caller(role), 'POST', path, {});
            expect(res.status).toBe(403);
            expect(restockService.restock).not.toHaveBeenCalled();
            expect(adjustmentService.adjust).not.toHaveBeenCalled();
        },
    );

    it('a service error keeps its status and code over HTTP', async () => {
        // e.g. insufficient stock inside the adjustment's transaction.
        adjustmentService.adjust.mockRejectedValue(
            new ValidationError(
                ErrorCode.VALIDATION_INVALID_INPUT,
                'Adjustment would make stock negative for one or more products',
                [{ product: ID, change: -5, available: 2 }],
            ),
        );
        const res = await harness.call(
            caller(Role.Adjuster),
            'POST',
            '/adjustments',
            {
                description: 'count',
                adjustDetails: [{ product: ID, change: -5, reason: 'broken' }],
            },
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
            error: ErrorCode.VALIDATION_INVALID_INPUT,
            details: [{ product: ID, change: -5, available: 2 }],
        });
    });
});
