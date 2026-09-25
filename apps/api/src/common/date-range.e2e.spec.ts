/**
 * Date-range list filters over real HTTP (issue #20): a reversed range
 * (`dateFrom` after `dateTo`) used to reach the service and list nothing.
 * The global ValidationPipe now refuses it with a 400 that says why, on
 * every list with a range, before any service call.
 */
import { Role } from '../auth/types';
import { ErrorCode } from './errors';
import {
    AccessHarness,
    bootAccessHarness,
    caller,
} from './testing/access-harness';
import { REVERSED_RANGE } from './testing/date-range';
import { AdjustmentController } from '../inventory-man/adjustment/adjustment.controller';
import { AdjustmentService } from '../inventory-man/adjustment/adjustment.service';
import { RestockController } from '../inventory-man/restock/restock.controller';
import { RestockService } from '../inventory-man/restock/restock.service';
import { SalesController } from '../sales/sales.controller';
import { SalesService } from '../sales/sales.service';

const EMPTY = { data: [], totalItems: 0 };

describe('Reversed date ranges on list filters (e2e, issue #20)', () => {
    let harness: AccessHarness;

    const restockService = { getAll: jest.fn().mockResolvedValue(EMPTY) };
    const adjustmentService = { getAll: jest.fn().mockResolvedValue(EMPTY) };
    const salesService = { getAll: jest.fn().mockResolvedValue(EMPTY) };

    beforeAll(async () => {
        harness = await bootAccessHarness(
            [RestockController, AdjustmentController, SalesController],
            [
                { provide: RestockService, useValue: restockService },
                { provide: AdjustmentService, useValue: adjustmentService },
                { provide: SalesService, useValue: salesService },
            ],
        );
    });

    afterAll(async () => {
        await harness.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    const lists = [
        ['/restocks', Role.Restocker, restockService],
        ['/adjustments', Role.Adjuster, adjustmentService],
        ['/sales', Role.Admin, salesService],
    ] as const;

    it.each(lists)(
        'GET %s refuses dateFrom after dateTo',
        async (path, role, service) => {
            const res = await harness.call(
                caller(role),
                'GET',
                `${path}?page=1&limit=5&dateFrom=2026-03-02&dateTo=2026-03-01`,
            );

            expect(res.status).toBe(400);
            const body = (await res.json()) as {
                error: string;
                details: { messages: string[] };
            };
            expect(body.error).toBe(ErrorCode.VALIDATION_INVALID_INPUT);
            expect(body.details.messages).toEqual([REVERSED_RANGE]);
            expect(service.getAll).not.toHaveBeenCalled();
        },
    );

    it.each(lists)(
        'GET %s accepts a one-day range',
        async (path, role, service) => {
            const res = await harness.call(
                caller(role),
                'GET',
                `${path}?page=1&limit=5&dateFrom=2026-03-01&dateTo=2026-03-01`,
            );

            expect(res.status).toBe(200);
            expect(service.getAll).toHaveBeenCalledTimes(1);
        },
    );
});
