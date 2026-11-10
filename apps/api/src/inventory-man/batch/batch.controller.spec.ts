import { InventoryBatchController } from './batch.controller';
import { InventoryBatchService } from './batch.service';
import {
    bootAccessHarness,
    caller,
    type AccessHarness,
} from '../../common/testing/access-harness';
import { Role } from '../../auth/types';
let harness: AccessHarness;
const list = jest.fn().mockResolvedValue({ data: [], totalItems: 0 });
const trackedProductCount = jest.fn().mockResolvedValue(3);
beforeAll(async () => {
    harness = await bootAccessHarness(
        [InventoryBatchController],
        [
            {
                provide: InventoryBatchService,
                useValue: { list, trackedProductCount },
            },
        ],
    );
});
afterAll(async () => harness?.close());
it.each([Role.Restocker, Role.Adjuster, Role.Admin])(
    'allows inventory batch inspection for %s',
    async (role) => {
        expect(
            (
                await harness.call(
                    caller(role),
                    'GET',
                    '/inventories/batches?product=507f1f77bcf86cd799439011&page=2&limit=10&expiring=false',
                )
            ).status,
        ).toBe(200);
        expect(list).toHaveBeenLastCalledWith(
            expect.objectContaining({ page: 2, limit: 10, expiring: false }),
        );
        expect(
            (
                await harness.call(
                    caller(role),
                    'GET',
                    '/inventories/expiring?days=0&expiring=true',
                )
            ).status,
        ).toBe(200);
        expect(list).toHaveBeenLastCalledWith(
            expect.objectContaining({
                page: 1,
                limit: 25,
                days: 0,
                expiring: true,
            }),
        );
    },
);
it.each([Role.Seller, Role.UserManager, Role.Supervisor])(
    'denies batch management data for %s',
    async (role) => {
        expect(
            (await harness.call(caller(role), 'GET', '/inventories/expiring'))
                .status,
        ).toBe(403);
    },
);
it.each([
    'days=-1',
    'days=366',
    'limit=101',
    'limit=0',
    'page=0',
    'product=wrong',
    'expiring=wrong',
])('validates bounded batch query %s', async (query) =>
    expect(
        (
            await harness.call(
                caller(Role.Admin),
                'GET',
                `/inventories/batches?${query}`,
            )
        ).status,
    ).toBe(400),
);
it.each([Role.Restocker, Role.Adjuster, Role.Admin])(
    'answers the expiry tracking signal for %s (#233)',
    async (role) => {
        const res = await harness.call(
            caller(role),
            'GET',
            '/inventories/expiry-tracking',
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ trackedProducts: 3 });
    },
);
it.each([Role.Seller, Role.UserManager, Role.Supervisor])(
    'denies the expiry tracking signal for %s (#233)',
    async (role) => {
        expect(
            (
                await harness.call(
                    caller(role),
                    'GET',
                    '/inventories/expiry-tracking',
                )
            ).status,
        ).toBe(403);
    },
);
