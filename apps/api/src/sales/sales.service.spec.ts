import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { ClientSession } from 'mongoose';
import { SalesService } from './sales.service';
import { Sales } from './sales.schema';
import { SalesDetails } from './sales-details.schema';
import { ProductService } from '../product/product.service';
import { InventoryService } from '../inventory-man/inventory/inventory.service';
import { ValidationError } from '../common/errors';
import { DiscountType, PaymentType, SellDto } from './types';
import { AuthUser } from '../auth/types';
import { Role } from '@grocery-pos/contracts';

const CASHIER: AuthUser = {
    userId: 'u1',
    username: 'admin',
    roles: [Role.Admin],
};

function sellDto(
    details: { product: string; quantity: number }[],
    discount?: SellDto['discount'],
): SellDto {
    return {
        paymentType: PaymentType.CASH,
        sellDetails: details,
        discount,
    } as SellDto;
}

/**
 * Cases the client's checkout preview is tested against too
 * (apps/client/src/components/User/Sales/checkout.spec.ts), so both sides
 * agree on the charged total to the centavo.
 */
const SHARED_DISCOUNT_CASES = [
    { subtotal: 100000, type: DiscountType.PERCENT, value: 20, amount: 20000 },
    { subtotal: 12990, type: DiscountType.PERCENT, value: 15, amount: 1949 },
    // 5% of 1,010 is 50.5 centavos: half-up gives 51.
    { subtotal: 1010, type: DiscountType.PERCENT, value: 5, amount: 51 },
    // 5% of 1,009 is 50.45 centavos: rounds down to 50.
    { subtotal: 1009, type: DiscountType.PERCENT, value: 5, amount: 50 },
    { subtotal: 5000, type: DiscountType.FIXED, value: 1250, amount: 1250 },
] as const;

describe('SalesService.sell', () => {
    let service: SalesService;
    let getMany: jest.Mock;
    let inventorySell: jest.Mock;
    let create: jest.Mock;
    let detailsBulkWrite: jest.Mock;

    beforeEach(async () => {
        getMany = jest.fn();
        inventorySell = jest.fn().mockResolvedValue(undefined);
        create = jest.fn().mockResolvedValue([{ _id: 'sale1' }]);
        detailsBulkWrite = jest.fn().mockResolvedValue(undefined);

        const session = {
            withTransaction: async (fn: (s: ClientSession) => unknown) =>
                fn({} as ClientSession),
            endSession: jest.fn(),
        };

        const moduleRef = await Test.createTestingModule({
            providers: [
                SalesService,
                {
                    provide: getConnectionToken(),
                    useValue: { startSession: () => Promise.resolve(session) },
                },
                { provide: getModelToken(Sales.name), useValue: { create } },
                {
                    provide: getModelToken(SalesDetails.name),
                    useValue: { bulkWrite: detailsBulkWrite },
                },
                { provide: ProductService, useValue: { getMany } },
                {
                    provide: InventoryService,
                    useValue: { sell: inventorySell },
                },
            ],
        }).compile();

        service = moduleRef.get(SalesService);
    });

    it('prices the sale from the database, not from client input', async () => {
        getMany.mockResolvedValue(
            new Map([
                ['p1', { name: 'bread', price: 746 }],
                ['p2', { name: 'milk', price: 100 }],
            ]),
        );

        const receipt = await service.sell(
            CASHIER,
            sellDto([
                { product: 'p1', quantity: 2 },
                { product: 'p2', quantity: 3 },
            ]),
        );

        // SellDto carries only {product, quantity}; every peso here came from
        // the product records the server looked up.
        expect(receipt.totalAmount).toBe(746 * 2 + 100 * 3);
        expect(receipt.cashierName).toBe('admin');
        expect(receipt.items).toEqual([
            { productName: 'bread', quantity: 2, amount: 1492 },
            { productName: 'milk', quantity: 3, amount: 300 },
        ]);

        expect(create).toHaveBeenCalledWith(
            [expect.objectContaining({ amount: 1792, cashier: 'u1' })],
            expect.anything(),
        );
    });

    it('totals in integer centavos, so line totals are exact', async () => {
        // As pesos in doubles, the ₱0.10 x 7 line alone is 0.7000000000000001.
        getMany.mockResolvedValue(
            new Map([
                ['p1', { name: 'bread', price: 1999 }],
                ['p2', { name: 'milk', price: 10 }],
            ]),
        );

        const receipt = await service.sell(
            CASHIER,
            sellDto([
                { product: 'p1', quantity: 3 },
                { product: 'p2', quantity: 7 },
            ]),
        );

        expect(receipt.totalAmount).toBe(6067);
        expect(Number.isInteger(receipt.totalAmount)).toBe(true);
        expect(create).toHaveBeenCalledWith(
            [expect.objectContaining({ amount: 6067 })],
            expect.anything(),
        );
    });

    it('prices inside the transaction so a concurrent edit cannot be read early', async () => {
        getMany.mockResolvedValue(
            new Map([['p1', { name: 'bread', price: 5 }]]),
        );

        await service.sell(CASHIER, sellDto([{ product: 'p1', quantity: 1 }]));

        // getMany must receive the transaction's session; reading prices before
        // the transaction opened allowed pricing from a stale snapshot.
        expect(getMany).toHaveBeenCalledWith(['p1'], expect.anything());
        expect(getMany.mock.calls[0][1]).toBeDefined();
    });

    it('rejects unknown products with a validation error, not a 500', async () => {
        getMany.mockResolvedValue(
            new Map([['p1', { name: 'bread', price: 5 }]]),
        );

        const attempt = service.sell(
            CASHIER,
            sellDto([
                { product: 'p1', quantity: 1 },
                { product: 'ghost', quantity: 1 },
            ]),
        );

        await expect(attempt).rejects.toBeInstanceOf(ValidationError);
        await expect(attempt).rejects.toMatchObject({
            statusCode: 400,
            details: ['ghost'],
        });
        expect(create).not.toHaveBeenCalled();
    });

    it('decrements inventory as part of the same transaction', async () => {
        getMany.mockResolvedValue(
            new Map([['p1', { name: 'bread', price: 5 }]]),
        );

        await service.sell(CASHIER, sellDto([{ product: 'p1', quantity: 4 }]));

        expect(inventorySell).toHaveBeenCalledTimes(1);
        expect(detailsBulkWrite).toHaveBeenCalledTimes(1);
    });

    describe('discounts', () => {
        const PRODUCT = '507f1f77bcf86cd799439011';

        function priceBasket(subtotal: number) {
            getMany.mockResolvedValue(
                new Map([[PRODUCT, { name: 'basket', price: subtotal }]]),
            );
            return [{ product: PRODUCT, quantity: 1 }];
        }

        it('charges ₱800 for ₱1,000 at 20% off and records who approved it', async () => {
            const receipt = await service.sell(
                CASHIER,
                sellDto(priceBasket(100000), {
                    type: DiscountType.PERCENT,
                    value: 20,
                    reason: 'loyalty',
                }),
            );

            expect(receipt).toMatchObject({
                subtotal: 100000,
                totalAmount: 80000,
                discount: {
                    type: DiscountType.PERCENT,
                    value: 20,
                    reason: 'loyalty',
                    amount: 20000,
                },
            });
            expect(create).toHaveBeenCalledWith(
                [
                    expect.objectContaining({
                        amount: 80000,
                        cashier: 'u1',
                        discount: {
                            type: DiscountType.PERCENT,
                            value: 20,
                            reason: 'loyalty',
                            amount: 20000,
                            approvedBy: 'u1',
                        },
                    }),
                ],
                expect.anything(),
            );
        });

        it('keeps the undiscounted unit price on each line', async () => {
            await service.sell(
                CASHIER,
                sellDto(priceBasket(100000), {
                    type: DiscountType.PERCENT,
                    value: 20,
                    reason: 'loyalty',
                }),
            );

            const [[inserts]] = detailsBulkWrite.mock.calls as [
                { insertOne: { document: { unitPrice: number } } }[],
            ][];
            expect(inserts[0].insertOne.document.unitPrice).toBe(100000);
        });

        it.each(SHARED_DISCOUNT_CASES)(
            '$type $value off $subtotal takes off $amount centavos',
            async ({ subtotal, type, value, amount }) => {
                const receipt = await service.sell(
                    CASHIER,
                    sellDto(priceBasket(subtotal), {
                        type,
                        value,
                        reason: 'promo',
                    }),
                );

                expect(receipt.discount?.amount).toBe(amount);
                expect(receipt.totalAmount).toBe(subtotal - amount);
            },
        );

        it('rejects a fixed discount larger than the subtotal', async () => {
            const attempt = service.sell(
                CASHIER,
                sellDto(priceBasket(5000), {
                    type: DiscountType.FIXED,
                    value: 5001,
                    reason: 'promo',
                }),
            );

            await expect(attempt).rejects.toBeInstanceOf(ValidationError);
            await expect(attempt).rejects.toMatchObject({ statusCode: 400 });
            expect(create).not.toHaveBeenCalled();
        });

        it('rejects a discount that leaves nothing to charge', async () => {
            for (const discount of [
                { type: DiscountType.FIXED, value: 5000, reason: 'promo' },
                { type: DiscountType.PERCENT, value: 100, reason: 'promo' },
            ]) {
                const attempt = service.sell(
                    CASHIER,
                    sellDto(priceBasket(5000), discount),
                );

                await expect(attempt).rejects.toMatchObject({
                    statusCode: 400,
                });
            }
            expect(create).not.toHaveBeenCalled();
        });

        it('leaves a sale without a discount unchanged', async () => {
            const receipt = await service.sell(
                CASHIER,
                sellDto(priceBasket(100000)),
            );

            expect(receipt).toMatchObject({
                subtotal: 100000,
                discount: null,
                totalAmount: 100000,
            });
            const [[[doc]]] = create.mock.calls as [
                [Record<string, unknown>],
            ][];
            expect(doc.amount).toBe(100000);
            expect(doc).not.toHaveProperty('discount');
        });
    });
});
