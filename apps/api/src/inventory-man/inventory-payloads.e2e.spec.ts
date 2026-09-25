/**
 * The restock and adjustment payloads the client builds, over real HTTP
 * (issue #33). The global ValidationPipe refuses any property a DTO does
 * not declare; adjustment lines used to carry the draft's display EAN and
 * name, so saving an adjustment failed on every attempt.
 *
 * The fixtures duplicate what the client's mappers in
 * apps/client/src/utils/payloads.ts build (`toRestockBody`,
 * `toAdjustmentBody`, checked there by payloads.spec.ts); keep the two in
 * step.
 */
import { ErrorCode } from '../common/errors';
import { Role } from '../auth/types';
import {
    AccessHarness,
    bootAccessHarness,
    caller,
} from '../common/testing/access-harness';
import { AdjustmentController } from './adjustment/adjustment.controller';
import { AdjustmentService } from './adjustment/adjustment.service';
import { RestockController } from './restock/restock.controller';
import { RestockService } from './restock/restock.service';

const PRODUCT = '507f1f77bcf86cd799439011';

// toRestockBody([existing, created with a typed EAN, created auto], ...)
const RESTOCK = {
    restockDetails: [
        { product: PRODUCT, quantity: 3, unitCost: 1000 },
        {
            newProduct: { EAN: '4006381333931', name: 'Bread', price: 1999 },
            quantity: 2,
            unitCost: 3500,
        },
        {
            newProduct: { name: 'Milk', price: 5000 },
            quantity: 1,
            unitCost: 4000,
        },
    ],
    description: 'delivery',
};

// toAdjustmentBody([draft], 'weekly count')
const ADJUSTMENT = {
    adjustDetails: [{ product: PRODUCT, change: -2, reason: 'damaged' }],
    description: 'weekly count',
};

describe('Restock and adjustment payloads from the client (e2e, issue #33)', () => {
    let harness: AccessHarness;

    const restockService = { restock: jest.fn().mockResolvedValue(undefined) };
    const adjustmentService = {
        adjust: jest.fn().mockResolvedValue(undefined),
    };

    beforeAll(async () => {
        harness = await bootAccessHarness(
            [RestockController, AdjustmentController],
            [
                { provide: RestockService, useValue: restockService },
                { provide: AdjustmentService, useValue: adjustmentService },
            ],
        );
    });

    afterAll(async () => {
        await harness.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /restocks', () => {
        it('accepts existing and new product lines and reaches the service', async () => {
            const res = await harness.call(
                caller(Role.Restocker),
                'POST',
                '/restocks',
                RESTOCK,
            );

            expect(res.status).toBe(201);
            expect(restockService.restock).toHaveBeenCalledWith(
                expect.anything(),
                {
                    restockDetails: [
                        { product: PRODUCT, quantity: 3, unitCost: 1000 },
                        {
                            newProduct: {
                                EAN: '4006381333931',
                                name: 'bread',
                                price: 1999,
                            },
                            quantity: 2,
                            unitCost: 3500,
                        },
                        {
                            newProduct: { name: 'milk', price: 5000 },
                            quantity: 1,
                            unitCost: 4000,
                        },
                    ],
                    description: 'delivery',
                },
            );
        });
    });

    describe('POST /adjustments', () => {
        it('accepts product, change and reason lines and reaches the service', async () => {
            const res = await harness.call(
                caller(Role.Adjuster),
                'POST',
                '/adjustments',
                ADJUSTMENT,
            );

            expect(res.status).toBe(201);
            expect(adjustmentService.adjust).toHaveBeenCalledWith(
                expect.anything(),
                ADJUSTMENT,
            );
        });

        it('refused the old draft rows with EAN and name (regression)', async () => {
            const res = await harness.call(
                caller(Role.Adjuster),
                'POST',
                '/adjustments',
                {
                    adjustDetails: [
                        {
                            EAN: '4006381333931',
                            name: 'bread',
                            product: PRODUCT,
                            change: -2,
                            reason: 'damaged',
                        },
                    ],
                    description: 'weekly count',
                },
            );
            const body = (await res.json()) as {
                error: string;
                details: { messages: string[] };
            };

            expect(res.status).toBe(400);
            expect(body.error).toBe(ErrorCode.VALIDATION_INVALID_INPUT);
            expect(body.details.messages).toEqual([
                'adjustDetails.0.property EAN should not exist',
                'adjustDetails.0.property name should not exist',
            ]);
            expect(adjustmentService.adjust).not.toHaveBeenCalled();
        });
    });
});
