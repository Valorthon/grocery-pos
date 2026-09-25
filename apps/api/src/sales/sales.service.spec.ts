import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { ClientSession, Types } from 'mongoose';
import {
    CASHIER_HIDDEN_SALE_FIELDS,
    saleScope,
    salesListFilter,
    SalesService,
} from './sales.service';
import { Sales } from './sales.schema';
import { SalesDetails } from './sales-details.schema';
import { ProductService } from '../product/product.service';
import { InventoryService } from '../inventory-man/inventory/inventory.service';
import {
    ConflictError,
    ErrorCode,
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
import { ShiftService } from '../shift/shift.service';
import { TypedConfigService } from '../common/typed-config/typed-config.service';

/** The store timezone every sales spec reads days in. */
const STORE_CONFIG = {
    provide: TypedConfigService,
    useValue: { get: () => 'Asia/Manila' },
};

/** The cashier's open shift in these tests. */
const SHIFT_ID = new Types.ObjectId();

const CASHIER: AuthUser = {
    userId: 'u1',
    username: 'admin',
    roles: [Role.Admin],
};

/** Cash large enough to cover any basket in these tests. */
const PLENTY_OF_CASH = [{ type: TenderType.CASH, amount: 100_000_000 }];

const KEY = '3f2b8c1e-9d4a-4e6b-8f7c-2a1d0e9b8c7d';

function sellDto(
    details: { product: string; quantity: number }[],
    discount?: SellDto['discount'],
    payment: Pick<SellDto, 'paymentType' | 'tenders' | 'referenceNumber'> = {
        paymentType: PaymentType.CASH,
        tenders: PLENTY_OF_CASH,
    },
): SellDto {
    return {
        idempotencyKey: KEY,
        ...payment,
        sellDetails: details,
        discount,
    } as SellDto;
}

/**
 * A chainable stand-in for a Mongoose query: `populate`, `sort` and
 * `session` return the query, `lean` resolves to `value`.
 */
function query(value: unknown) {
    const q = {
        populate: () => q,
        sort: () => q,
        session: () => q,
        lean: () => Promise.resolve(value),
    };
    return q;
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
    let findOne: jest.Mock;
    let detailsFind: jest.Mock;
    let chargeSale: jest.Mock;

    beforeEach(async () => {
        getMany = jest.fn();
        chargeSale = jest.fn().mockResolvedValue(SHIFT_ID);
        // No sale recorded under the key yet, unless a test says otherwise.
        findOne = jest.fn().mockReturnValue(query(null));
        detailsFind = jest.fn().mockReturnValue(query([]));
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
                {
                    provide: getModelToken(Sales.name),
                    useValue: { create, findOne },
                },
                {
                    provide: getModelToken(SalesDetails.name),
                    useValue: {
                        bulkWrite: detailsBulkWrite,
                        find: detailsFind,
                    },
                },
                { provide: ProductService, useValue: { getMany } },
                {
                    provide: InventoryService,
                    useValue: { sell: inventorySell },
                },
                { provide: ShiftService, useValue: { chargeSale } },
                STORE_CONFIG,
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
        expect(inventorySell).toHaveBeenCalledWith(
            'u1',
            expect.anything(),
            expect.anything(),
        );
        expect(detailsBulkWrite).toHaveBeenCalledTimes(1);
    });

    it('prices duplicate lines for one product and leaves the stock check to the netted total (issue #14)', async () => {
        // InventoryService.sell nets these into one guarded decrement of 7
        // and reports a shortfall as `requested: 7` (see its spec).
        getMany.mockResolvedValue(
            new Map([['p1', { name: 'bread', price: 500 }]]),
        );
        const shortfall = new ValidationError(
            ErrorCode.VALIDATION_INVALID_INPUT,
            'Insufficient stock for one or more products',
            [{ product: 'p1', name: 'bread', requested: 7, available: 5 }],
        );
        inventorySell.mockRejectedValue(shortfall);
        const dto = sellDto([
            { product: 'p1', quantity: 3 },
            { product: 'p1', quantity: 4 },
        ]);

        await expect(service.sell(CASHIER, dto)).rejects.toBe(shortfall);
        // Both lines reach the inventory write unmerged; it does the netting.
        expect(inventorySell).toHaveBeenCalledWith(
            'u1',
            expect.objectContaining({ sellDetails: dto.sellDetails }),
            expect.anything(),
        );
    });

    describe('shift (issue #2)', () => {
        beforeEach(() => {
            getMany.mockResolvedValue(
                new Map([['p1', { name: 'bread', price: 500 }]]),
            );
        });

        it('records the sale into the cashier’s open shift, first thing in the transaction', async () => {
            await service.sell(
                CASHIER,
                sellDto([{ product: 'p1', quantity: 1 }]),
            );

            expect(chargeSale).toHaveBeenCalledWith('u1', expect.anything());
            expect(create).toHaveBeenCalledWith(
                [expect.objectContaining({ shift: SHIFT_ID })],
                expect.anything(),
            );
            // Before pricing: a refused sale reads nothing.
            expect(chargeSale.mock.invocationCallOrder[0]).toBeLessThan(
                getMany.mock.invocationCallOrder[0],
            );
        });

        it('refuses a sale with no open shift and writes nothing', async () => {
            chargeSale.mockRejectedValue(
                new ConflictError(ErrorCode.SHIFT_NOT_OPEN, 'no shift'),
            );

            const attempt = service.sell(
                CASHIER,
                sellDto([{ product: 'p1', quantity: 1 }]),
            );

            await expect(attempt).rejects.toMatchObject({
                statusCode: 409,
                code: ErrorCode.SHIFT_NOT_OPEN,
            });
            expect(getMany).not.toHaveBeenCalled();
            expect(create).not.toHaveBeenCalled();
            expect(inventorySell).not.toHaveBeenCalled();
            expect(detailsBulkWrite).not.toHaveBeenCalled();
        });

        it('replays a recorded sale without needing an open shift', async () => {
            const stored = {
                _id: 'sale1',
                cashier: new Types.ObjectId(),
                createdAt: CREATED_AT,
                amount: 500,
                paymentType: PaymentType.CASH,
                tenders: [{ type: TenderType.CASH, amount: 1000 }],
                amountTendered: 1000,
                changeGiven: 500,
                status: SaleStatus.COMPLETED,
                idempotencyKey: KEY,
                shift: SHIFT_ID,
            };
            const dto = sellDto([{ product: 'p1', quantity: 1 }]);
            // The request hash of this very request, as the first try stored it.
            await service.sell(CASHIER, dto);
            const [[[doc]]] = create.mock.calls as [
                [Record<string, unknown>],
            ][];
            findOne.mockReturnValue(
                query({ ...stored, requestHash: doc.requestHash }),
            );
            // The shift has closed since.
            chargeSale.mockClear();
            chargeSale.mockRejectedValue(
                new ConflictError(ErrorCode.SHIFT_NOT_OPEN, 'no shift'),
            );
            create.mockClear();

            const replay = await service.sell(CASHIER, dto);

            expect(replay._id).toBe('sale1');
            expect(replay.changeGiven).toBe(500);
            expect(chargeSale).not.toHaveBeenCalled();
            expect(create).not.toHaveBeenCalled();
        });
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

    describe('idempotency', () => {
        const PRODUCT = '507f1f77bcf86cd799439011';
        const REF = '1234567890123';
        const basket = [{ product: PRODUCT, quantity: 1 }];
        const discount = {
            type: DiscountType.PERCENT,
            value: 20,
            reason: 'loyalty',
        };
        const gcash = {
            paymentType: PaymentType.GCASH,
            referenceNumber: REF,
            tenders: [{ type: TenderType.GCASH, amount: 100000 }],
        };

        function duplicateKey(field: string) {
            return Object.assign(new Error('E11000 duplicate key'), {
                name: 'MongoServerError',
                code: 11000,
                keyPattern: { [field]: 1 },
            });
        }

        // A one-sale in-memory collection behind the model mocks. `winner`
        // lets a test commit a sale "concurrently", from inside create().
        let stored: Record<string, unknown> | null;
        let lines: Record<string, unknown>[];

        function commit(doc: Record<string, unknown>, id = 'sale1') {
            stored = {
                ...doc,
                _id: id,
                createdAt: CREATED_AT,
            };
            return stored;
        }

        beforeEach(() => {
            getMany.mockResolvedValue(
                new Map([[PRODUCT, { name: 'basket', price: 100000 }]]),
            );
            stored = null;
            lines = [];

            create.mockImplementation(([doc]: [Record<string, unknown>]) => {
                if (stored?.idempotencyKey === doc.idempotencyKey) {
                    return Promise.reject(duplicateKey('idempotencyKey'));
                }
                return Promise.resolve([commit(doc)]);
            });
            findOne.mockImplementation((filter: { idempotencyKey: string }) =>
                query(
                    stored?.idempotencyKey === filter.idempotencyKey
                        ? stored
                        : null,
                ),
            );
            detailsBulkWrite.mockImplementation(
                (
                    ops: { insertOne: { document: Record<string, unknown> } }[],
                ) => {
                    lines = ops.map(({ insertOne }) => ({
                        ...insertOne.document,
                        product: { name: 'basket' },
                    }));
                    return Promise.resolve(undefined);
                },
            );
            detailsFind.mockImplementation(() => query(lines));
        });

        it('records one sale for a key sent twice and replays the original receipt', async () => {
            const dto = sellDto(basket, discount, {
                paymentType: PaymentType.CASH,
                tenders: [{ type: TenderType.CASH, amount: 150000 }],
            });

            const first = await service.sell(CASHIER, dto);
            const second = await service.sell(CASHIER, { ...dto });

            expect(create).toHaveBeenCalledTimes(1);
            expect(inventorySell).toHaveBeenCalledTimes(1);
            expect(detailsBulkWrite).toHaveBeenCalledTimes(1);
            expect(second._id).toBe(first._id);
            // Same shape and figures as the fresh response, not a new sale.
            expect(second).toEqual(first);
            expect(second).toMatchObject({
                subtotal: 100000,
                totalAmount: 80000,
                changeGiven: 70000,
                discount: { amount: 20000 },
            });
        });

        it('stores the key and a request fingerprint on the sale', async () => {
            await service.sell(CASHIER, sellDto(basket));

            const [[[doc]]] = create.mock.calls as [
                [Record<string, unknown>],
            ][];
            expect(doc.idempotencyKey).toBe(KEY);
            expect(doc.requestHash).toMatch(/^[0-9a-f]{64}$/);
        });

        it('treats a reordered request as the same request', async () => {
            const lines2 = [
                { product: PRODUCT, quantity: 1 },
                { product: '507f1f77bcf86cd799439012', quantity: 2 },
            ];
            getMany.mockResolvedValue(
                new Map([
                    [PRODUCT, { name: 'basket', price: 100000 }],
                    ['507f1f77bcf86cd799439012', { name: 'milk', price: 100 }],
                ]),
            );

            const first = await service.sell(CASHIER, sellDto(lines2));
            const second = await service.sell(
                CASHIER,
                sellDto([...lines2].reverse()),
            );

            expect(second._id).toBe(first._id);
            expect(create).toHaveBeenCalledTimes(1);
        });

        it.each([
            [
                'a different quantity',
                sellDto([{ product: PRODUCT, quantity: 2 }]),
            ],
            ['a discount', sellDto(basket, discount)],
            [
                'different tenders',
                sellDto(basket, undefined, {
                    paymentType: PaymentType.CASH,
                    tenders: [{ type: TenderType.CASH, amount: 200000 }],
                }),
            ],
            ['another payment type', sellDto(basket, undefined, gcash)],
        ])('refuses the same key with %s with a 409', async (_, changed) => {
            const original = await service.sell(CASHIER, sellDto(basket));

            const attempt = service.sell(CASHIER, changed);

            await expect(attempt).rejects.toBeInstanceOf(ConflictError);
            // The cashier's own sale: the 409 carries its stored receipt,
            // original tenders included, so the client can settle on it.
            await expect(attempt).rejects.toMatchObject({
                statusCode: 409,
                code: ErrorCode.SALE_IDEMPOTENCY_MISMATCH,
                details: { sale: 'sale1', receipt: original },
            });
            expect(create).toHaveBeenCalledTimes(1);
            expect(inventorySell).toHaveBeenCalledTimes(1);
        });

        it('refuses the same key from another cashier without leaking the sale', async () => {
            await service.sell(CASHIER, sellDto(basket));

            await expect(
                service.sell(
                    { ...CASHIER, userId: 'u2', username: 'other' },
                    sellDto(basket),
                ),
            ).rejects.toMatchObject({
                statusCode: 409,
                code: ErrorCode.SALE_IDEMPOTENCY_MISMATCH,
                details: null,
            });
        });

        it('replays a voided sale with its current status', async () => {
            await service.sell(CASHIER, sellDto(basket));
            stored!.status = SaleStatus.VOIDED;

            const replay = await service.sell(CASHIER, sellDto(basket));

            expect(replay.status).toBe(SaleStatus.VOIDED);
            expect(create).toHaveBeenCalledTimes(1);
        });

        it('returns the committed sale when a concurrent insert wins the key', async () => {
            // The pre-check saw nothing; by insert time the other request
            // with this key has committed.
            create.mockImplementationOnce(
                ([doc]: [Record<string, unknown>]) => {
                    commit(doc, 'winner');
                    lines = [
                        {
                            product: { name: 'basket' },
                            quantity: 1,
                            unitPrice: 100000,
                        },
                    ];
                    return Promise.reject(duplicateKey('idempotencyKey'));
                },
            );

            const receipt = await service.sell(CASHIER, sellDto(basket));

            expect(receipt._id).toBe('winner');
            expect(receipt.totalAmount).toBe(100000);
            expect(receipt.items).toEqual([
                { productName: 'basket', quantity: 1, amount: 100000 },
            ]);
            expect(inventorySell).not.toHaveBeenCalled();
            expect(detailsBulkWrite).not.toHaveBeenCalled();
        });

        it('asks to retry when the winning sale is not visible yet', async () => {
            create.mockRejectedValueOnce(duplicateKey('idempotencyKey'));

            const attempt = service.sell(CASHIER, sellDto(basket));

            await expect(attempt).rejects.toBeInstanceOf(ConflictError);
            await expect(attempt).rejects.toMatchObject({
                statusCode: 409,
                code: ErrorCode.SALE_IN_PROGRESS,
            });
            expect(inventorySell).not.toHaveBeenCalled();
        });

        it('replays a sale whose concurrent twin failed on stock the winner took', async () => {
            await service.sell(CASHIER, sellDto(basket));
            // A loser that got past the pre-check before the winner committed
            // then fails on stock; it still answers with the winner's sale.
            findOne.mockReturnValueOnce(query(null));
            create.mockResolvedValueOnce([
                { _id: 'loser', createdAt: CREATED_AT },
            ]);
            inventorySell.mockRejectedValueOnce(
                new ValidationError(
                    ErrorCode.VALIDATION_INVALID_INPUT,
                    'Insufficient stock',
                ),
            );

            const receipt = await service.sell(CASHIER, sellDto(basket));

            expect(receipt._id).toBe('sale1');
        });

        it('rethrows the original error when no sale holds the key', async () => {
            // The transaction rolls back, so nothing is left under the key.
            create.mockResolvedValueOnce([
                { _id: 'sale1', createdAt: CREATED_AT },
            ]);
            inventorySell.mockRejectedValueOnce(
                new ValidationError(
                    ErrorCode.VALIDATION_INVALID_INPUT,
                    'Insufficient stock',
                ),
            );

            await expect(
                service.sell(CASHIER, sellDto(basket)),
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        describe('GCash', () => {
            it('replays a GCash sale instead of refusing its own reference', async () => {
                const first = await service.sell(
                    CASHIER,
                    sellDto(basket, undefined, gcash),
                );
                const second = await service.sell(
                    CASHIER,
                    sellDto(basket, undefined, gcash),
                );

                expect(second).toEqual(first);
                expect(second.referenceNumber).toBe(REF);
                expect(create).toHaveBeenCalledTimes(1);
            });

            it('replays when a concurrent twin trips the reference index first', async () => {
                create.mockImplementationOnce(
                    ([doc]: [Record<string, unknown>]) => {
                        commit(doc, 'winner');
                        return Promise.reject(duplicateKey('referenceNumber'));
                    },
                );

                const receipt = await service.sell(
                    CASHIER,
                    sellDto(basket, undefined, gcash),
                );

                expect(receipt._id).toBe('winner');
            });

            it('still refuses a reference used by a sale with another key', async () => {
                await service.sell(CASHIER, sellDto(basket, undefined, gcash));
                create.mockRejectedValueOnce(duplicateKey('referenceNumber'));

                const attempt = service.sell(CASHIER, {
                    ...sellDto(basket, undefined, gcash),
                    idempotencyKey: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
                });

                await expect(attempt).rejects.toMatchObject({
                    statusCode: 409,
                    code: ErrorCode.SALE_DUPLICATE_REFERENCE,
                });
            });
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
    let updateOne: jest.Mock;
    let payOutReversal: jest.Mock;

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
        updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
        // A GCash-only sale by default: nothing to pay out.
        payOutReversal = jest.fn().mockResolvedValue(null);

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
                    useValue: { findOneAndUpdate, findById, updateOne },
                },
                {
                    provide: getModelToken(SalesDetails.name),
                    useValue: { find: detailsFind },
                },
                { provide: ProductService, useValue: {} },
                { provide: InventoryService, useValue: { returnStock } },
                { provide: ShiftService, useValue: { payOutReversal } },
                STORE_CONFIG,
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

        // The admin who reversed the sale is the rows' updatedBy (#14).
        expect(returnStock).toHaveBeenCalledWith(
            ADMIN.userId,
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

    describe('cash payout (issue #2)', () => {
        const SALE_SHIFT = new Types.ObjectId();
        const OTHER_SHIFT = new Types.ObjectId();

        function claimed(extra: Record<string, unknown>) {
            findOneAndUpdate.mockReturnValue(
                chain({
                    _id: new Types.ObjectId(SALE),
                    status: SaleStatus.REFUNDED,
                    amount: 80000,
                    reversal: { type: ReversalType.REFUND, reason: 'x' },
                    ...extra,
                }),
            );
        }

        it('pays the net cash (cash tendered less change) out of the sale’s shift and records it', async () => {
            claimed({
                paymentType: PaymentType.CASH,
                tenders: [{ type: TenderType.CASH, amount: 100000 }],
                changeGiven: 20000,
                shift: SALE_SHIFT,
            });
            payOutReversal.mockResolvedValue(SALE_SHIFT);

            const sale = await service.reverse(ADMIN, SALE, {
                type: ReversalType.REFUND,
                reason: 'customer return',
            });

            expect(payOutReversal).toHaveBeenCalledWith(
                expect.objectContaining({
                    saleId: SALE,
                    saleShift: SALE_SHIFT,
                    amount: 80000,
                    payoutShiftId: undefined,
                    type: ReversalType.REFUND,
                    admin: ADMIN,
                }),
                expect.anything(),
            );
            expect(updateOne).toHaveBeenCalledWith(
                { _id: new Types.ObjectId(SALE) },
                {
                    $set: {
                        'reversal.payoutShift': SALE_SHIFT,
                        'reversal.payoutAmount': 80000,
                    },
                },
                expect.anything(),
            );
            expect(sale.reversal).toMatchObject({
                payoutShift: SALE_SHIFT,
                payoutAmount: 80000,
            });
            expect(returnStock).toHaveBeenCalledTimes(1);
        });

        it('pays only the cash part of a split sale, less change', async () => {
            claimed({
                paymentType: PaymentType.SPLIT,
                tenders: [
                    { type: TenderType.CASH, amount: 50000 },
                    { type: TenderType.GCASH, amount: 50000 },
                ],
                changeGiven: 20000,
                shift: SALE_SHIFT,
            });

            await service.reverse(ADMIN, SALE, {
                type: ReversalType.VOID,
                reason: 'x',
            });

            expect(payOutReversal).toHaveBeenCalledWith(
                expect.objectContaining({ amount: 30000 }),
                expect.anything(),
            );
        });

        it('passes the admin’s chosen shift along for a sale whose shift closed', async () => {
            claimed({
                paymentType: PaymentType.CASH,
                tenders: [{ type: TenderType.CASH, amount: 80000 }],
                changeGiven: 0,
                shift: SALE_SHIFT,
            });
            payOutReversal.mockResolvedValue(OTHER_SHIFT);

            const sale = await service.reverse(ADMIN, SALE, {
                type: ReversalType.REFUND,
                reason: 'x',
                payoutShiftId: String(OTHER_SHIFT),
            });

            expect(payOutReversal).toHaveBeenCalledWith(
                expect.objectContaining({ payoutShiftId: String(OTHER_SHIFT) }),
                expect.anything(),
            );
            expect(sale.reversal.payoutShift).toBe(OTHER_SHIFT);
        });

        it('touches no drawer and records no payout for a GCash-only sale', async () => {
            claimed({
                paymentType: PaymentType.GCASH,
                tenders: [{ type: TenderType.GCASH, amount: 80000 }],
                changeGiven: 0,
                shift: SALE_SHIFT,
            });

            const sale = await service.reverse(ADMIN, SALE, {
                type: ReversalType.VOID,
                reason: 'x',
            });

            expect(payOutReversal).toHaveBeenCalledWith(
                expect.objectContaining({ amount: 0 }),
                expect.anything(),
            );
            expect(updateOne).not.toHaveBeenCalled();
            expect(sale.reversal).not.toHaveProperty('payoutShift');
            expect(returnStock).toHaveBeenCalledTimes(1);
        });

        it('passes a sale from before shifts as having no shift', async () => {
            claimed({ paymentType: PaymentType.CASH });

            await service.reverse(ADMIN, SALE, {
                type: ReversalType.VOID,
                reason: 'x',
            });

            expect(payOutReversal).toHaveBeenCalledWith(
                expect.objectContaining({ saleShift: null, amount: 80000 }),
                expect.anything(),
            );
        });

        it('returns no stock when the payout is refused', async () => {
            claimed({
                paymentType: PaymentType.CASH,
                tenders: [{ type: TenderType.CASH, amount: 80000 }],
                changeGiven: 0,
                shift: SALE_SHIFT,
            });
            payOutReversal.mockRejectedValue(
                new ConflictError(ErrorCode.SHIFT_PAYOUT_REQUIRED, 'choose'),
            );

            const attempt = service.reverse(ADMIN, SALE, {
                type: ReversalType.REFUND,
                reason: 'x',
            });

            await expect(attempt).rejects.toMatchObject({
                statusCode: 409,
                code: ErrorCode.SHIFT_PAYOUT_REQUIRED,
            });
            expect(returnStock).not.toHaveBeenCalled();
            expect(updateOne).not.toHaveBeenCalled();
        });
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

describe('Sales history scoping (issues #13, #2)', () => {
    const SELLER: AuthUser = {
        userId: '507f1f77bcf86cd799439011',
        username: 'ana',
        roles: [Role.Seller, Role.Restocker],
    };
    const ADMIN: AuthUser = {
        userId: '507f1f77bcf86cd799439012',
        username: 'boss',
        roles: [Role.Admin],
    };
    const OPEN_SHIFT = new Types.ObjectId();
    const OWN_SCOPE = {
        cashier: new Types.ObjectId(SELLER.userId),
        shift: OPEN_SHIFT,
    };

    let service: SalesService;
    let find: jest.Mock;
    let countDocuments: jest.Mock;
    let estimatedDocumentCount: jest.Mock;
    let exists: jest.Mock;
    let detailsFind: jest.Mock;
    let openShiftIdOf: jest.Mock;

    beforeEach(async () => {
        const page = {
            sort: () => page,
            skip: () => page,
            limit: () => page,
            populate: () => page,
            lean: () => Promise.resolve([]),
        };
        find = jest.fn(() => page);
        countDocuments = jest.fn().mockResolvedValue(0);
        estimatedDocumentCount = jest.fn().mockResolvedValue(0);
        exists = jest.fn();
        detailsFind = jest.fn(() => query([]));
        openShiftIdOf = jest.fn().mockResolvedValue(OPEN_SHIFT);

        const moduleRef = await Test.createTestingModule({
            providers: [
                SalesService,
                { provide: getConnectionToken(), useValue: {} },
                {
                    provide: getModelToken(Sales.name),
                    useValue: {
                        find,
                        countDocuments,
                        estimatedDocumentCount,
                        exists,
                    },
                },
                {
                    provide: getModelToken(SalesDetails.name),
                    useValue: { find: detailsFind },
                },
                { provide: ProductService, useValue: {} },
                { provide: InventoryService, useValue: {} },
                { provide: ShiftService, useValue: { openShiftIdOf } },
                STORE_CONFIG,
            ],
        }).compile();

        service = moduleRef.get(SalesService);
    });

    it('scopes a non-admin to their own sales in their open shift, even with other roles', () => {
        expect(saleScope(SELLER, OPEN_SHIFT)).toEqual(OWN_SCOPE);
    });

    it('gives a non-admin with no open shift no scope at all', () => {
        expect(saleScope(SELLER, null)).toBeNull();
    });

    it('does not scope an admin, shift or not', () => {
        expect(saleScope(ADMIN, null)).toEqual({});
        expect(saleScope(ADMIN, OPEN_SHIFT)).toEqual({});
    });

    it('lists and counts only the cashier’s own current-shift sales', async () => {
        await service.getAll(SELLER, { page: 1, limit: 10 });

        expect(openShiftIdOf).toHaveBeenCalledWith(SELLER.userId);
        expect(find).toHaveBeenCalledWith(
            OWN_SCOPE,
            CASHIER_HIDDEN_SALE_FIELDS,
        );
        expect(countDocuments).toHaveBeenCalledWith(OWN_SCOPE);
        expect(estimatedDocumentCount).not.toHaveBeenCalled();
    });

    it('hides who paid a reversal back, and how much, from a non-admin', () => {
        expect(CASHIER_HIDDEN_SALE_FIELDS).toEqual({
            'reversal.payoutShift': 0,
            'reversal.payoutAmount': 0,
        });
    });

    it('lists nothing for a cashier with no open shift, without querying sales', async () => {
        openShiftIdOf.mockResolvedValue(null);

        await expect(
            service.getAll(SELLER, { page: 1, limit: 10 }),
        ).resolves.toEqual({ data: [], totalItems: 0 });
        expect(find).not.toHaveBeenCalled();
        expect(countDocuments).not.toHaveBeenCalled();
    });

    it('lists every sale for an admin, with an exact count (#16)', async () => {
        await service.getAll(ADMIN, { page: 1, limit: 10 });

        expect(find).toHaveBeenCalledWith({}, undefined);
        expect(countDocuments).toHaveBeenCalledWith({});
        expect(estimatedDocumentCount).not.toHaveBeenCalled();
        expect(openShiftIdOf).not.toHaveBeenCalled();
    });

    describe('filters (#16)', () => {
        const OTHER = new Types.ObjectId();
        // Manila is UTC+8: its 2026-09-25 runs from 16:00Z on the 24th.
        const SEP_25 = {
            $gte: new Date('2026-09-24T16:00:00.000Z'),
            $lt: new Date('2026-09-25T16:00:00.000Z'),
        };

        it('filters an admin’s list and count by cashier and Manila day', async () => {
            await service.getAll(ADMIN, {
                page: 1,
                limit: 10,
                cashier: OTHER.toString(),
                dateFrom: '2026-09-25',
                dateTo: '2026-09-25',
            });

            const filter = { cashier: OTHER, createdAt: SEP_25 };
            expect(find).toHaveBeenCalledWith(filter, undefined);
            expect(countDocuments).toHaveBeenCalledWith(filter);
        });

        it('keeps a seller’s shift scope under a date filter', async () => {
            await service.getAll(SELLER, {
                page: 1,
                limit: 10,
                dateFrom: '2026-09-25',
            });

            expect(find).toHaveBeenCalledWith(
                { ...OWN_SCOPE, createdAt: { $gte: SEP_25.$gte } },
                CASHIER_HIDDEN_SALE_FIELDS,
            );
        });

        it('lists nothing, without querying, when a seller names another cashier', async () => {
            await expect(
                service.getAll(SELLER, {
                    page: 1,
                    limit: 10,
                    cashier: OTHER.toString(),
                }),
            ).resolves.toEqual({ data: [], totalItems: 0 });
            expect(find).not.toHaveBeenCalled();
            expect(countDocuments).not.toHaveBeenCalled();
        });

        it('lets a seller name themselves, which changes nothing', () => {
            expect(
                salesListFilter(
                    OWN_SCOPE,
                    { cashier: SELLER.userId },
                    'Asia/Manila',
                ),
            ).toEqual(OWN_SCOPE);
        });

        it('adds nothing when no filter is given', () => {
            expect(salesListFilter({}, {}, 'Asia/Manila')).toEqual({});
        });

        it('ends a dateTo day at the next Manila midnight', () => {
            expect(
                salesListFilter({}, { dateTo: '2026-09-24' }, 'Asia/Manila'),
            ).toEqual({
                createdAt: { $lt: new Date('2026-09-24T16:00:00.000Z') },
            });
        });
    });

    it('404s a sale outside the cashier’s current shift without reading its lines', async () => {
        exists.mockResolvedValue(null);
        const sale = new Types.ObjectId().toString();

        await expect(
            service.getDetails(SELLER, { sales: sale }),
        ).rejects.toBeInstanceOf(NotFoundError);
        expect(exists).toHaveBeenCalledWith({ _id: sale, ...OWN_SCOPE });
        expect(detailsFind).not.toHaveBeenCalled();
    });

    it('404s every sale for a cashier with no open shift', async () => {
        openShiftIdOf.mockResolvedValue(null);
        exists.mockResolvedValue({ _id: 's1' });

        await expect(
            service.getDetails(SELLER, { sales: 's1' }),
        ).rejects.toBeInstanceOf(NotFoundError);
        expect(exists).not.toHaveBeenCalled();
        expect(detailsFind).not.toHaveBeenCalled();
    });

    it('returns the lines of a visible sale', async () => {
        exists.mockResolvedValue({ _id: 's1' });

        await expect(
            service.getDetails(ADMIN, { sales: 's1' }),
        ).resolves.toEqual([]);
        expect(exists).toHaveBeenCalledWith({ _id: 's1' });
    });
});
