/**
 * Who reaches GET /dashboard and which fields they get, over real HTTP
 * (issue #13). The real DashboardController and DashboardService run behind
 * the real guards and filter; only the models are faked. The fake restock
 * query honours `select`, so a projection that let `totalCost` through
 * would show up here.
 */
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { Role } from '../auth/types';
import {
    AccessHarness,
    ALL_ROLES,
    bootAccessHarness,
    caller,
} from '../common/testing/access-harness';
import { Sales } from '../sales/sales.schema';
import { Inventory } from '../inventory-man/inventory/inventory.schema';
import { Product } from '../product/product.schema';
import { Restock } from '../inventory-man/restock/restock.schema';
import { Adjustment } from '../inventory-man/adjustment/adjustment.schema';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

type Row = Record<string, unknown>;

/** A `find()` chain over fixed rows that applies a `select` projection. */
function findOver(rows: Row[]) {
    return () => {
        let fields: string[] | null = null;
        const chain = {
            sort: () => chain,
            limit: () => chain,
            populate: () => chain,
            select: (projection: string) => {
                fields = projection.split(/\s+/);
                return chain;
            },
            lean: () =>
                Promise.resolve(
                    rows.map((row) =>
                        fields
                            ? Object.fromEntries(
                                  Object.entries(row).filter(([key]) =>
                                      fields!.includes(key),
                                  ),
                              )
                            : row,
                    ),
                ),
        };
        return chain;
    };
}

/** Sums `$amount` only when the pipeline asks for revenue. */
function aggregate(pipeline: Array<{ $group?: Row }>) {
    const group = pipeline.find((stage) => stage.$group)!.$group!;
    return Promise.resolve([
        { count: 2, ...('revenue' in group && { revenue: 12_500 }) },
    ]);
}

const SALE = {
    _id: new Types.ObjectId().toString(),
    amount: 12_500,
    paymentType: 'CASH',
    cashier: { name: 'ana' },
    createdAt: new Date().toISOString(),
};
const RESTOCK = {
    _id: new Types.ObjectId().toString(),
    description: 'weekly delivery',
    totalCost: 90_000,
    restockedBy: { name: 'rex' },
    createdAt: new Date().toISOString(),
};
const ADJUSTMENT = {
    _id: new Types.ObjectId().toString(),
    description: 'broken jars',
    adjustedBy: { name: 'ada' },
    createdAt: new Date().toISOString(),
};

/** The management roles that reach the dashboard without ADMIN. */
const MANAGEMENT = [Role.Adjuster, Role.Restocker, Role.UserManager];

describe('GET /dashboard access by role (e2e)', () => {
    let harness: AccessHarness;

    beforeAll(async () => {
        harness = await bootAccessHarness(
            [DashboardController],
            [
                DashboardService,
                {
                    provide: getModelToken(Sales.name),
                    useValue: { aggregate, find: findOver([SALE]) },
                },
                {
                    provide: getModelToken(Inventory.name),
                    useValue: { countDocuments: () => Promise.resolve(3) },
                },
                {
                    provide: getModelToken(Product.name),
                    useValue: {
                        estimatedDocumentCount: () => Promise.resolve(40),
                    },
                },
                {
                    provide: getModelToken(Restock.name),
                    useValue: { find: findOver([RESTOCK]) },
                },
                {
                    provide: getModelToken(Adjustment.name),
                    useValue: { find: findOver([ADJUSTMENT]) },
                },
            ],
        );
    });

    afterAll(async () => {
        await harness.close();
    });

    function get(...roles: Role[]) {
        return harness.call(caller(...roles), 'GET', '/dashboard');
    }

    it.each(ALL_ROLES.map((role) => [role, role !== Role.Seller] as const))(
        'as %s -> allowed: %s',
        async (role, allowed) => {
            const res = await get(role);
            expect(res.status).toBe(allowed ? 200 : 403);
        },
    );

    it('gives an admin every money figure', async () => {
        const body = (await (await get(Role.Admin)).json()) as Row;

        expect(body).toEqual({
            totalProducts: 40,
            lowStockCount: 3,
            todaySalesCount: 2,
            todayRevenue: 12_500,
            recentSales: [SALE],
            recentRestocks: [RESTOCK],
            recentAdjustments: [ADJUSTMENT],
        });
    });

    it.each(MANAGEMENT)(
        'gives %s stock and activity, with no money fields',
        async (role) => {
            const body = (await (await get(role)).json()) as Row;

            expect(body).toEqual({
                totalProducts: 40,
                lowStockCount: 3,
                todaySalesCount: 2,
                recentRestocks: [
                    {
                        _id: RESTOCK._id,
                        description: RESTOCK.description,
                        restockedBy: RESTOCK.restockedBy,
                        createdAt: RESTOCK.createdAt,
                    },
                ],
                recentAdjustments: [ADJUSTMENT],
            });
            expect(JSON.stringify(body)).not.toMatch(
                /todayRevenue|recentSales|totalCost|amount/,
            );
        },
    );

    it('treats a cashier who is also a restocker as management, without money', async () => {
        const res = await get(Role.Seller, Role.Restocker);
        const body = (await res.json()) as Row;

        expect(res.status).toBe(200);
        expect(body).not.toHaveProperty('todayRevenue');
        expect(body).not.toHaveProperty('recentSales');
    });
});
