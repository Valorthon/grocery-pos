import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { DashboardService } from './dashboard.service';
import { Sales } from '../sales/sales.schema';
import { Inventory } from '../inventory-man/inventory/inventory.schema';
import { Product } from '../product/product.schema';
import { Restock } from '../inventory-man/restock/restock.schema';
import { Adjustment } from '../inventory-man/adjustment/adjustment.schema';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { SaleStatus } from '@grocery-pos/contracts';

function recentQuery() {
    const chain = {
        sort: () => chain,
        limit: () => chain,
        populate: () => chain,
        lean: () => Promise.resolve([]),
    };
    return chain;
}

describe('DashboardService.getDashboard', () => {
    const originalTz = process.env.TZ;
    let service: DashboardService;
    let aggregate: jest.Mock;

    beforeEach(async () => {
        // The API container runs in UTC; the store is in Manila (UTC+8).
        process.env.TZ = 'UTC';
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

        aggregate = jest.fn().mockResolvedValue([{ count: 1, revenue: 500 }]);

        const find = () => recentQuery();

        const moduleRef = await Test.createTestingModule({
            providers: [
                DashboardService,
                {
                    provide: getModelToken(Sales.name),
                    useValue: { aggregate, find },
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
                { provide: getModelToken(Restock.name), useValue: { find } },
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

        await service.getDashboard();

        const { $gte, $lt } = matchedRange();
        expect($gte.toISOString()).toBe('2026-01-04T16:00:00.000Z');
        expect($lt.toISOString()).toBe('2026-01-05T16:00:00.000Z');
    });

    it('counts a 07:00 Manila sale as today', async () => {
        const saleAt = new Date('2026-01-04T23:00:00.000Z');
        jest.setSystemTime(new Date('2026-01-05T02:00:00.000Z')); // 10:00 PHT

        const result = await service.getDashboard();

        const { $gte, $lt } = matchedRange();
        expect(saleAt >= $gte && saleAt < $lt).toBe(true);
        expect(result.todayRevenue).toBe(500);
    });

    it('rolls over at Manila midnight', async () => {
        // 23:59 Manila on 2026-01-05.
        jest.setSystemTime(new Date('2026-01-05T15:59:00.000Z'));
        await service.getDashboard();
        expect(matchedRange().$gte.toISOString()).toBe(
            '2026-01-04T16:00:00.000Z',
        );

        aggregate.mockClear();

        // 00:00 Manila on 2026-01-06.
        jest.setSystemTime(new Date('2026-01-05T16:00:00.000Z'));
        await service.getDashboard();
        expect(matchedRange().$gte.toISOString()).toBe(
            '2026-01-05T16:00:00.000Z',
        );
    });

    it('leaves voided and refunded sales out of revenue and the count', async () => {
        jest.setSystemTime(new Date('2026-01-05T02:00:00.000Z'));

        await service.getDashboard();

        const pipeline = aggregate.mock.calls[0][0] as Array<{
            $match?: Record<string, unknown>;
        }>;
        // "Not reversed" rather than "COMPLETED", so sales stored before the
        // status field existed still count.
        expect(pipeline[0].$match).toMatchObject({
            status: { $nin: [SaleStatus.VOIDED, SaleStatus.REFUNDED] },
        });
    });
});
