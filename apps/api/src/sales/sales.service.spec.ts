import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { ClientSession, Types } from 'mongoose';
import { SalesService } from './sales.service';
import { Sales } from './sales.schema';
import { SalesDetails } from './sales-details.schema';
import { ProductService } from '../product/product.service';
import { InventoryService } from '../inventory-man/inventory/inventory.service';
import {
    ConflictError,
    NotFoundError,
    ValidationError,
} from '../common/errors';
import {
    DiscountType,
    PaymentType,
    ReversalType,
    SaleStatus,
    SellDto,
    TenderType,
} from './types';
import { AuthUser } from '../auth/types';
import { Role } from '@grocery-pos/contracts';

const CASHIER: AuthUser = {
    userId: 'u1',
    username: 'admin',
    roles: [Role.Admin],
};

/** Cash large enough to cover any basket in these tests. */
const PLENTY_OF_CASH = [{ type: TenderType.CASH, amount: 100_000_000 }];

function sellDto(
    details: { product: string; quantity: number }[],
    discount?: SellDto['discount'],
    payment: Pick<SellDto, 'paymentType' | 'tenders' | 'referenceNumber'> = {
        paymentType: PaymentType.CASH,
        tenders: PLENTY_OF_CASH,
    },
): SellDto {
    return {
        ...payment,
        sellDetails: details,
        discount,
    } as SellDto;
}

const CREATED_AT = new Date('2026-09-24T02:00:00.000Z');

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

/** Cases both sides refuse: the server with a 400, the preview as not chargeable. */
const SHARED_REJECTED_CASES = [
    // 5% of 9 centavos is 0.45: the discount rounds to nothing.
    { subtotal: 9, type: DiscountType.PERCENT, value: 5 },
    { subtotal: 5000, type: DiscountType.FIXED, value: 5001 },
    { subtotal: 5000, type: DiscountType.FIXED, value: 5000 },
    { subtotal: 5000, type: DiscountType.PERCENT, value: 100 },
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
        create = jest
            .fn()
            .mockResolvedValue([{ _id: 'sale1', createdAt: CREATED_AT }]);
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

        it.each(SHARED_REJECTED_CASES)(
            'rejects $type $value off $subtotal with a 400',
            async ({ subtotal, type, value }) => {
                const attempt = service.sell(
                    CASHIER,
                    sellDto(priceBasket(subtotal), {
                        type,
                        value,
                        reason: 'promo',
                    }),
                );

                await expect(attempt).rejects.toBeInstanceOf(ValidationError);
                await expect(attempt).rejects.toMatchObject({
                    statusCode: 400,
                });
                expect(create).not.toHaveBeenCalled();
            },
        );

        it('rejects a malformed discount that yields no integer total', async () => {
            // An array body used to slip past validation and total NaN.
            const attempt = service.sell(
                CASHIER,
                sellDto(
                    priceBasket(5000),
                    [] as unknown as SellDto['discount'],
                ),
            );

            await expect(attempt).rejects.toMatchObject({ statusCode: 400 });
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

    describe('payment', () => {
        const PRODUCT = '507f1f77bcf86cd799439011';
        const REF = '1234567890123';

        beforeEach(() => {
            getMany.mockResolvedValue(
                new Map([[PRODUCT, { name: 'basket', price: 100000 }]]),
            );
        });

        const basket = [{ product: PRODUCT, quantity: 1 }];

        function createdDoc(): Record<string, unknown> {
            const [[[doc]]] = create.mock.calls as [
                [Record<string, unknown>],
            ][];
            return doc;
        }

        it('returns the sale id and creation time so the sale can be looked up', async () => {
            const receipt = await service.sell(CASHIER, sellDto(basket));

            expect(receipt._id).toBe('sale1');
            expect(receipt.createdAt).toBe(CREATED_AT);
            expect(receipt.status).toBe(SaleStatus.COMPLETED);
        });

        it('records cash tendered and the change the server computed', async () => {
            const receipt = await service.sell(
                CASHIER,
                sellDto(basket, undefined, {
                    paymentType: PaymentType.CASH,
                    tenders: [{ type: TenderType.CASH, amount: 150000 }],
                }),
            );

            expect(receipt).toMatchObject({
                paymentType: PaymentType.CASH,
                referenceNumber: null,
                tenders: [{ type: TenderType.CASH, amount: 150000 }],
                amountTendered: 150000,
                changeGiven: 50000,
            });
            expect(createdDoc()).toMatchObject({
                status: SaleStatus.COMPLETED,
                amountTendered: 150000,
                changeGiven: 50000,
            });
        });

        it('books a split sale as SPLIT with both tenders, not as GCash', async () => {
            const receipt = await service.sell(
                CASHIER,
                sellDto(basket, undefined, {
                    paymentType: PaymentType.SPLIT,
                    referenceNumber: REF,
                    tenders: [
                        { type: TenderType.CASH, amount: 50000 },
                        { type: TenderType.GCASH, amount: 50000 },
                    ],
                }),
            );

            expect(receipt).toMatchObject({
                paymentType: PaymentType.SPLIT,
                referenceNumber: REF,
                amountTendered: 100000,
                changeGiven: 0,
            });
            expect(createdDoc()).toMatchObject({
                paymentType: PaymentType.SPLIT,
                referenceNumber: REF,
                tenders: [
                    { type: TenderType.CASH, amount: 50000 },
                    { type: TenderType.GCASH, amount: 50000 },
                ],
            });
        });

        it('checks the tenders against the discounted server total', async () => {
            // ₱1,000 at 20% off is ₱800: ₱800 GCash is exact, ₱1,000 is not.
            const discount = {
                type: DiscountType.PERCENT,
                value: 20,
                reason: 'loyalty',
            };

            await expect(
                service.sell(
                    CASHIER,
                    sellDto(basket, discount, {
                        paymentType: PaymentType.GCASH,
                        referenceNumber: REF,
                        tenders: [{ type: TenderType.GCASH, amount: 100000 }],
                    }),
                ),
            ).rejects.toMatchObject({ statusCode: 400 });

            const receipt = await service.sell(
                CASHIER,
                sellDto(basket, discount, {
                    paymentType: PaymentType.GCASH,
                    referenceNumber: REF,
                    tenders: [{ type: TenderType.GCASH, amount: 80000 }],
                }),
            );
            expect(receipt.changeGiven).toBe(0);
        });

        it('rejects tenders that do not cover the total before writing', async () => {
            const attempt = service.sell(
                CASHIER,
                sellDto(basket, undefined, {
                    paymentType: PaymentType.CASH,
                    tenders: [{ type: TenderType.CASH, amount: 99999 }],
                }),
            );

            await expect(attempt).rejects.toBeInstanceOf(ValidationError);
            expect(create).not.toHaveBeenCalled();
            expect(inventorySell).not.toHaveBeenCalled();
        });

        it('returns a 409, not a 500, for a reused GCash reference', async () => {
            create.mockRejectedValue(
                Object.assign(new Error('E11000 duplicate key'), {
                    name: 'MongoServerError',
                    code: 11000,
                    keyPattern: { referenceNumber: 1 },
                }),
            );

            const attempt = service.sell(
                CASHIER,
                sellDto(basket, undefined, {
                    paymentType: PaymentType.GCASH,
                    referenceNumber: REF,
                    tenders: [{ type: TenderType.GCASH, amount: 100000 }],
                }),
            );

            await expect(attempt).rejects.toBeInstanceOf(ConflictError);
            await expect(attempt).rejects.toMatchObject({
                statusCode: 409,
                details: { referenceNumber: REF },
            });
            expect(inventorySell).not.toHaveBeenCalled();
        });
    });
});

describe('SalesService.reverse', () => {
    const SALE = '507f1f77bcf86cd799439099';
    const ADMIN: AuthUser = {
        userId: '507f1f77bcf86cd799439001',
        username: 'boss',
        roles: [Role.Admin],
    };
    const P1 = new Types.ObjectId();
    const P2 = new Types.ObjectId();

    let service: SalesService;
    let findOneAndUpdate: jest.Mock;
    let findById: jest.Mock;
    let detailsFind: jest.Mock;
    let returnStock: jest.Mock;

    const chain = (value: unknown) => {
        const c = {
            session: () => c,
            lean: () => Promise.resolve(value),
        };
        return c;
    };

    beforeEach(async () => {
        findOneAndUpdate = jest.fn();
        findById = jest.fn();
        detailsFind = jest.fn().mockReturnValue(
            chain([
                { product: P1, quantity: 2 },
                { product: P2, quantity: 5 },
            ]),
        );
        returnStock = jest.fn().mockResolvedValue(undefined);

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
                {
                    provide: getModelToken(Sales.name),
                    useValue: { findOneAndUpdate, findById },
                },
                {
                    provide: getModelToken(SalesDetails.name),
                    useValue: { find: detailsFind },
                },
                { provide: ProductService, useValue: {} },
                { provide: InventoryService, useValue: { returnStock } },
            ],
        }).compile();

        service = moduleRef.get(SalesService);
    });

    it('voids a completed sale and returns its stock', async () => {
        findOneAndUpdate.mockReturnValue(
            chain({ _id: SALE, status: SaleStatus.VOIDED }),
        );

        const sale = await service.reverse(ADMIN, SALE, {
            type: ReversalType.VOID,
            reason: 'rang up twice',
        });

        expect(sale.status).toBe(SaleStatus.VOIDED);

        const [[filter, update]] = findOneAndUpdate.mock.calls as [
            [
                Record<string, unknown>,
                { $set: { status: string; reversal: Record<string, unknown> } },
            ],
        ];
        // Only a sale not already reversed can match: the double-void guard.
        expect(filter).toEqual({
            _id: SALE,
            status: { $nin: [SaleStatus.VOIDED, SaleStatus.REFUNDED] },
        });
        expect(update.$set.status).toBe(SaleStatus.VOIDED);
        expect(update.$set.reversal).toMatchObject({
            type: ReversalType.VOID,
            reason: 'rang up twice',
        });
        expect(String(update.$set.reversal.approvedBy)).toBe(ADMIN.userId);
        expect(update.$set.reversal.at).toBeInstanceOf(Date);

        expect(returnStock).toHaveBeenCalledWith(
            [
                { product: P1, quantity: 2 },
                { product: P2, quantity: 5 },
            ],
            expect.anything(),
        );
    });

    it('marks a refund as REFUNDED and also returns stock', async () => {
        findOneAndUpdate.mockReturnValue(
            chain({ _id: SALE, status: SaleStatus.REFUNDED }),
        );

        await service.reverse(ADMIN, SALE, {
            type: ReversalType.REFUND,
            reason: 'customer return',
        });

        const [[, update]] = findOneAndUpdate.mock.calls as [
            [unknown, { $set: { status: string } }],
        ];
        expect(update.$set.status).toBe(SaleStatus.REFUNDED);
        expect(returnStock).toHaveBeenCalledTimes(1);
    });

    it('refuses to reverse a sale twice with a 409 and returns no stock', async () => {
        findOneAndUpdate.mockReturnValue(chain(null));
        findById.mockReturnValue(chain({ status: SaleStatus.VOIDED }));

        const attempt = service.reverse(ADMIN, SALE, {
            type: ReversalType.REFUND,
            reason: 'again',
        });

        await expect(attempt).rejects.toBeInstanceOf(ConflictError);
        await expect(attempt).rejects.toMatchObject({ statusCode: 409 });
        expect(returnStock).not.toHaveBeenCalled();
    });

    it('returns a 404 for an unknown sale', async () => {
        findOneAndUpdate.mockReturnValue(chain(null));
        findById.mockReturnValue(chain(null));

        const attempt = service.reverse(ADMIN, SALE, {
            type: ReversalType.VOID,
            reason: 'x',
        });

        await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
        expect(returnStock).not.toHaveBeenCalled();
    });
});
