import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { DashboardService, RESTOCK_ACTIVITY_FIELDS } from './dashboard.service';
import { Sales } from '../sales/sales.schema';
import { Inventory } from '../inventory-man/inventory/inventory.schema';
import { Product } from '../product/product.schema';
import { Restock } from '../inventory-man/restock/restock.schema';
import { Adjustment } from '../inventory-man/adjustment/adjustment.schema';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { SaleStatus } from '@grocery-pos/contracts';

interface RecentQuery {
    sort: () => RecentQuery;
    limit: () => RecentQuery;
    populate: () => RecentQuery;
    select: jest.Mock;
    lean: () => Promise<unknown[]>;
}

function recentQuery(rows: unknown[] = []): RecentQuery {
    const chain: RecentQuery = {
        sort: () => chain,
        limit: () => chain,
        populate: () => chain,
        select: jest.fn(() => chain),
        lean: () => Promise.resolve(rows),
    };
    return chain;
}

describe('DashboardService.getDashboard', () => {
    const originalTz = process.env.TZ;
    let service: DashboardService;
    let aggregate: jest.Mock;
    let salesFind: jest.Mock;
    let restockQuery: RecentQuery;

    beforeEach(async () => {
        // The API container runs in UTC; the store is in Manila (UTC+8).
        process.env.TZ = 'UTC';
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

        aggregate = jest.fn().mockResolvedValue([{ count: 1, revenue: 500 }]);

        const find = () => recentQuery();
        salesFind = jest.fn(() => recentQuery([{ _id: 's1', amount: 500 }]));
        restockQuery = recentQuery();

        const moduleRef = await Test.createTestingModule({
            providers: [
                DashboardService,
                {
                    provide: getModelToken(Sales.name),
                    useValue: { aggregate, find: salesFind },
                },
                {
                    provide: getModelToken(Inventory.name),
                    useValue: { countDocuments: () => Promise.resolve(0) },
                },
                {
                    provide: getModelToken(Product.name),
                    useValue: {
                        estimatedDocumentCount: () => Promise.resolve(0),
                    },
                },
                {
                    provide: getModelToken(Restock.name),
                    useValue: { find: () => restockQuery },
                },
                {
                    provide: getModelToken(Adjustment.name),
                    useValue: { find },
                },
                {
                    provide: TypedConfigService,
                    useValue: { get: () => 'Asia/Manila' },
                },
            ],
        }).compile();

        service = moduleRef.get(DashboardService);
    });

    afterEach(() => {
        jest.useRealTimers();
        process.env.TZ = originalTz;
    });

    function matchedRange(): { $gte: Date; $lt: Date } {
        const pipeline = aggregate.mock.calls[0][0] as Array<{
            $match?: { createdAt: { $gte: Date; $lt: Date } };
        }>;
        return pipeline[0].$match!.createdAt;
    }

    it('bounds "today" by Manila midnight, not server midnight', async () => {
        // 07:00 Manila on 2026-01-05 is 23:00 UTC on 2026-01-04.
        jest.setSystemTime(new Date('2026-01-04T23:00:00.000Z'));

        await service.getDashboard({ includeMoney: true });

        const { $gte, $lt } = matchedRange();
        expect($gte.toISOString()).toBe('2026-01-04T16:00:00.000Z');
        expect($lt.toISOString()).toBe('2026-01-05T16:00:00.000Z');
    });

    it('counts a 07:00 Manila sale as today', async () => {
        const saleAt = new Date('2026-01-04T23:00:00.000Z');
        jest.setSystemTime(new Date('2026-01-05T02:00:00.000Z')); // 10:00 PHT

        const result = await service.getDashboard({ includeMoney: true });

        const { $gte, $lt } = matchedRange();
        expect(saleAt >= $gte && saleAt < $lt).toBe(true);
        expect(result.todayRevenue).toBe(500);
    });

    it('rolls over at Manila midnight', async () => {
        // 23:59 Manila on 2026-01-05.
        jest.setSystemTime(new Date('2026-01-05T15:59:00.000Z'));
        await service.getDashboard({ includeMoney: true });
        expect(matchedRange().$gte.toISOString()).toBe(
            '2026-01-04T16:00:00.000Z',
        );

        aggregate.mockClear();

        // 00:00 Manila on 2026-01-06.
        jest.setSystemTime(new Date('2026-01-05T16:00:00.000Z'));
        await service.getDashboard({ includeMoney: true });
        expect(matchedRange().$gte.toISOString()).toBe(
            '2026-01-05T16:00:00.000Z',
        );
    });

    it('leaves voided and refunded sales out of revenue and the count', async () => {
        jest.setSystemTime(new Date('2026-01-05T02:00:00.000Z'));

        await service.getDashboard({ includeMoney: true });

        const pipeline = aggregate.mock.calls[0][0] as Array<{
            $match?: Record<string, unknown>;
        }>;
        // "Not reversed" rather than "COMPLETED", so sales stored before the
        // status field existed still count.
        expect(pipeline[0].$match).toMatchObject({
            status: { $nin: [SaleStatus.VOIDED, SaleStatus.REFUNDED] },
        });
    });

    describe('money figures (issue #13)', () => {
        beforeEach(() => {
            jest.setSystemTime(new Date('2026-01-05T02:00:00.000Z'));
        });

        function groupStage(): Record<string, unknown> {
            const pipeline = aggregate.mock.calls[0][0] as Array<{
                $group?: Record<string, unknown>;
            }>;
            return pipeline[1].$group!;
        }

        it('gives an admin revenue, the recent-sales feed and restock costs', async () => {
            const result = await service.getDashboard({ includeMoney: true });

            expect(result.todayRevenue).toBe(500);
            expect(result.recentSales).toEqual([{ _id: 's1', amount: 500 }]);
            expect(groupStage()).toHaveProperty('revenue');
            expect(restockQuery.select).not.toHaveBeenCalled();
        });

        it('leaves every money field out for other roles', async () => {
            const result = await service.getDashboard({ includeMoney: false });

            expect(result).toEqual({
                totalProducts: 0,
                lowStockCount: 0,
                todaySalesCount: 1,
                recentRestocks: [],
                recentAdjustments: [],
            });
        });

        it('does not even read money for other roles', async () => {
            await service.getDashboard({ includeMoney: false });

            // No revenue sum, no sales feed query, restocks without totalCost.
            expect(groupStage()).not.toHaveProperty('revenue');
            expect(salesFind).not.toHaveBeenCalled();
            expect(restockQuery.select).toHaveBeenCalledWith(
                RESTOCK_ACTIVITY_FIELDS,
            );
            expect(RESTOCK_ACTIVITY_FIELDS).not.toMatch(/totalCost/);
        });
    });
});
