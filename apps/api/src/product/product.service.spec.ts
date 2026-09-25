import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import mongoose, { ClientSession } from 'mongoose';
import {
    assertMayChangePrices,
    MAX_MATCHES,
    ProductService,
} from './product.service';
import { Role, type AuthUser } from '../auth/types';
import { ErrorCode, ForbiddenError, ValidationError } from '../common/errors';
import { Product, ProductSchema } from './product.schema';
import { InventoryService } from '../inventory-man/inventory/inventory.service';
import { EanCounterService } from '../ean-counter/ean-counter.service';
import {
    EnsureValidDto,
    GetAllDto,
    MatchesDto,
    NewProductFields,
    UpdateBulkDto,
} from './types';
import { BARCODE_MESSAGES } from '@grocery-pos/contracts';

describe('ProductService.update', () => {
    let service: ProductService;
    let updateOne: jest.Mock;

    beforeEach(async () => {
        updateOne = jest.fn().mockResolvedValue(undefined);

        const session = {
            withTransaction: async (fn: (s: ClientSession) => unknown) =>
                fn({} as ClientSession),
            endSession: jest.fn(),
        };

        const moduleRef = await Test.createTestingModule({
            providers: [
                ProductService,
                {
                    provide: getConnectionToken(),
                    useValue: { startSession: () => Promise.resolve(session) },
                },
                {
                    provide: getModelToken(Product.name),
                    useValue: { updateOne },
                },
                { provide: InventoryService, useValue: {} },
                { provide: EanCounterService, useValue: {} },
            ],
        }).compile();

        service = moduleRef.get(ProductService);
    });

    const ADMIN: AuthUser = {
        userId: '507f1f77bcf86cd799439011',
        username: 'admin',
        roles: [Role.Admin],
    };
    const RESTOCKER: AuthUser = {
        userId: '507f1f77bcf86cd799439012',
        username: 'restocker',
        roles: [Role.Restocker, Role.Adjuster],
    };

    it('runs schema validators on every price update', async () => {
        // bulkWrite would skip them, letting a fractional price through.
        await service.update(ADMIN, {
            updates: [
                { product: 'p1', update: { price: 1999 } },
                { product: 'p2', update: { name: 'milk' } },
            ],
        } as UpdateBulkDto);

        expect(updateOne).toHaveBeenCalledTimes(2);
        expect(updateOne).toHaveBeenCalledWith(
            { _id: 'p1' },
            { $set: { price: 1999 } },
            expect.objectContaining({
                runValidators: true,
                session: expect.anything(),
            }),
        );
    });

    describe('price changes (issue #13)', () => {
        it('lets a non-admin edit non-price fields', async () => {
            await service.update(RESTOCKER, {
                updates: [{ product: 'p2', update: { name: 'milk' } }],
            } as UpdateBulkDto);

            expect(updateOne).toHaveBeenCalledTimes(1);
        });

        it('refuses the whole batch when a non-admin sets any price', async () => {
            const attempt = service.update(RESTOCKER, {
                updates: [
                    { product: 'p2', update: { name: 'milk' } },
                    { product: 'p1', update: { price: 1999 } },
                ],
            } as UpdateBulkDto);

            await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
            await expect(attempt).rejects.toMatchObject({
                code: ErrorCode.PRODUCT_PRICE_CHANGE_FORBIDDEN,
                statusCode: 403,
                details: { products: ['p1'] },
            });
            // Not even the name edit is written.
            expect(updateOne).not.toHaveBeenCalled();
        });

        it('lets an admin change prices', () => {
            expect(() =>
                assertMayChangePrices(ADMIN, {
                    updates: [{ product: 'p1', update: { price: 1 } }],
                } as UpdateBulkDto),
            ).not.toThrow();
        });
    });
});

describe('Product schema price', () => {
    const ProductModel = mongoose.model(Product.name, ProductSchema);

    function priceError(price: number) {
        const doc = new ProductModel({ EAN: '1', name: 'bread', price });
        return doc.validateSync()?.errors.price?.kind;
    }

    it('accepts a whole number of centavos', () => {
        expect(priceError(1999)).toBeUndefined();
    });

    it('rejects fractional money and a free product', () => {
        expect(priceError(19.99)).toBe('user defined');
        expect(priceError(0)).toBe('min');
    });
});

describe('ProductService.getMatches', () => {
    let service: ProductService;
    let find: jest.Mock;
    let limit: jest.Mock;

    beforeEach(async () => {
        limit = jest.fn().mockReturnValue({
            lean: () =>
                Promise.resolve([
                    {
                        _id: new mongoose.Types.ObjectId(),
                        EAN: '2000000000015',
                        name: 'milk',
                    },
                ]),
        });
        find = jest.fn().mockReturnValue({ sort: () => ({ limit }) });

        const moduleRef = await Test.createTestingModule({
            providers: [
                ProductService,
                { provide: getConnectionToken(), useValue: {} },
                { provide: getModelToken(Product.name), useValue: { find } },
                { provide: InventoryService, useValue: {} },
                { provide: EanCounterService, useValue: {} },
            ],
        }).compile();

        service = moduleRef.get(ProductService);
    });

    function queryFor(dto: Partial<MatchesDto>): unknown {
        return service
            .getMatches(dto as MatchesDto)
            .then(() => find.mock.calls[0][0] as unknown);
    }

    it('matches a name fragment, with regex characters taken literally', async () => {
        expect(await queryFor({ name: 'c++ (1*' })).toEqual({
            name: { $regex: 'c\\+\\+ \\(1\\*' },
        });
    });

    it('matches a digits-only term against the name or part of the EAN', async () => {
        expect(await queryFor({ name: '0001' })).toEqual({
            $or: [{ name: { $regex: '0001' } }, { EAN: { $regex: '0001' } }],
        });
    });

    it('keeps the EAN prefix search for an explicit EAN', async () => {
        expect(await queryFor({ EAN: '200' })).toEqual({
            EAN: { $regex: '^200' },
        });
    });

    it('caps the result count', async () => {
        await service.getMatches({ name: 'a' } as MatchesDto);

        expect(limit).toHaveBeenCalledWith(MAX_MATCHES);
    });

    it('returns the matches as { EAN, name, product }', async () => {
        const [match] = await service.getMatches({ name: 'mi' } as MatchesDto);

        expect(match).toEqual({
            EAN: '2000000000015',
            name: 'milk',
            product: expect.any(String),
        });
    });

    it('returns nothing, without a query, for an empty search', async () => {
        expect(await service.getMatches({} as MatchesDto)).toEqual([]);
        expect(find).not.toHaveBeenCalled();
    });
});

describe('ProductService.createMany / addMany (issue #14)', () => {
    let service: ProductService;
    let insertMany: jest.Mock;
    let generate: jest.Mock;
    let inventoryCreateMany: jest.Mock;

    /** Runs the callback twice, as a transaction retry after a transient error. */
    function retryingSession() {
        return {
            withTransaction: async (fn: (s: ClientSession) => unknown) => {
                await fn({} as ClientSession);
                return fn({} as ClientSession);
            },
            endSession: jest.fn(),
        };
    }

    beforeEach(async () => {
        insertMany = jest.fn((docs: object[]) =>
            Promise.resolve(
                docs.map((doc) => ({
                    ...doc,
                    _id: new mongoose.Types.ObjectId(),
                })),
            ),
        );
        let counter = 0;
        generate = jest.fn(() => Promise.resolve(`generated-${++counter}`));
        inventoryCreateMany = jest.fn().mockResolvedValue(undefined);

        const moduleRef = await Test.createTestingModule({
            providers: [
                ProductService,
                {
                    provide: getConnectionToken(),
                    useValue: {
                        startSession: () => Promise.resolve(retryingSession()),
                    },
                },
                {
                    provide: getModelToken(Product.name),
                    useValue: { insertMany },
                },
                {
                    provide: InventoryService,
                    useValue: { createMany: inventoryCreateMany },
                },
                { provide: EanCounterService, useValue: { generate } },
            ],
        }).compile();

        service = moduleRef.get(ProductService);
    });

    const ADMIN: AuthUser = {
        userId: '507f1f77bcf86cd799439011',
        username: 'admin',
        roles: [Role.Admin],
    };

    /** The first inserted document's EAN, per insertMany call. */
    function insertedEANs(): string[] {
        return (insertMany.mock.calls as [{ EAN: string }[]][]).map(
            ([docs]) => docs[0].EAN,
        );
    }

    it('does not write generated EANs into the caller’s DTO', async () => {
        const products: NewProductFields[] = [
            { name: 'bread', price: 100 } as NewProductFields,
            {
                name: 'milk',
                price: 200,
                EAN: '4006381333931',
            } as NewProductFields,
        ];
        const before = structuredClone(products);

        const ids = await service.createMany(products, {} as ClientSession);

        expect(products).toEqual(before);
        expect(ids).toHaveLength(2);
        expect(insertMany).toHaveBeenCalledWith(
            [
                { name: 'bread', price: 100, EAN: 'generated-1' },
                { name: 'milk', price: 200, EAN: '4006381333931' },
            ],
            expect.anything(),
        );
    });

    it('generates a fresh EAN on each attempt of a retried transaction', async () => {
        // The first attempt's EAN came from a counter increment that was
        // rolled back; reusing it would collide with a later generate().
        const products = [{ name: 'bread', price: 100 } as NewProductFields];
        const session = {} as ClientSession;

        await service.createMany(products, session);
        await service.createMany(products, session);

        expect(generate).toHaveBeenCalledTimes(2);
        expect(insertedEANs()).toEqual(['generated-1', 'generated-2']);
        expect(products[0].EAN).toBeUndefined();
    });

    it('addMany does the same across its own transaction retry', async () => {
        const dto = { newProducts: [{ name: 'bread', price: 100 }] } as {
            newProducts: NewProductFields[];
        };

        await service.addMany(ADMIN, dto);

        expect(dto.newProducts[0].EAN).toBeUndefined();
        expect(insertedEANs()).toEqual(['generated-1', 'generated-2']);
        expect(inventoryCreateMany).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['letters', 'abc', BARCODE_MESSAGES.FORMAT],
        ['a bad check digit', '4006381333932', BARCODE_MESSAGES.CHECK_DIGIT],
        ['the generated range', '2000000000015', BARCODE_MESSAGES.RESERVED],
    ])(
        'refuses %s on every write path, even past the DTO',
        async (_label, EAN, message) => {
            const products = [
                { name: 'bread', price: 100, EAN } as NewProductFields,
            ];

            const attempt = service.createMany(products, {} as ClientSession);

            await expect(attempt).rejects.toBeInstanceOf(ValidationError);
            await expect(attempt).rejects.toMatchObject({
                code: ErrorCode.VALIDATION_EAN_INVALID,
                details: [{ index: 0, EAN, message }],
            });
            await expect(
                service.addMany(ADMIN, { newProducts: products }),
            ).rejects.toBeInstanceOf(ValidationError);
            expect(insertMany).not.toHaveBeenCalled();
            expect(generate).not.toHaveBeenCalled();
        },
    );

    it('creates nothing for an empty list', async () => {
        await expect(
            service.createMany([], {} as ClientSession),
        ).resolves.toEqual([]);
        expect(insertMany).not.toHaveBeenCalled();
    });
});

describe('ProductService.ensureValid (issue #14)', () => {
    let service: ProductService;
    let findOne: jest.Mock;

    beforeEach(async () => {
        findOne = jest.fn().mockReturnValue({
            lean: () => Promise.resolve(null),
        });

        const moduleRef = await Test.createTestingModule({
            providers: [
                ProductService,
                { provide: getConnectionToken(), useValue: {} },
                {
                    provide: getModelToken(Product.name),
                    useValue: { findOne },
                },
                { provide: InventoryService, useValue: {} },
                { provide: EanCounterService, useValue: {} },
            ],
        }).compile();

        service = moduleRef.get(ProductService);
    });

    it.each([['4006381333931'], ['036000291452'], ['96385074']])(
        'accepts %s, as the create DTOs do',
        async (EAN) => {
            await expect(
                service.ensureValid({ EAN, name: 'bread' } as EnsureValidDto),
            ).resolves.toBeUndefined();
        },
    );

    it.each([
        ['4006381333932', BARCODE_MESSAGES.CHECK_DIGIT],
        ['2000000000015', BARCODE_MESSAGES.RESERVED],
        ['12345', BARCODE_MESSAGES.FORMAT],
    ])('refuses %s with the same rule as the DTOs', async (EAN, message) => {
        await expect(
            service.ensureValid({ EAN, name: 'bread' } as EnsureValidDto),
        ).rejects.toMatchObject({
            code: ErrorCode.VALIDATION_EAN_INVALID,
            statusCode: 400,
            message,
        });
    });

    it('requires a barcode unless it is auto-generated', async () => {
        await expect(
            service.ensureValid({ name: 'bread' } as EnsureValidDto),
        ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_EAN_INVALID });
        await expect(
            service.ensureValid({
                name: 'bread',
                autoGenerateEAN: true,
            } as EnsureValidDto),
        ).resolves.toBeUndefined();
    });
});

describe('ProductService.getAll search (issue #14)', () => {
    let service: ProductService;
    let find: jest.Mock;
    let countDocuments: jest.Mock;
    let estimatedDocumentCount: jest.Mock;

    beforeEach(async () => {
        const chain = {
            sort: () => chain,
            skip: () => chain,
            limit: () => chain,
            lean: () => Promise.resolve([]),
        };
        find = jest.fn().mockReturnValue(chain);
        countDocuments = jest.fn().mockResolvedValue(0);
        estimatedDocumentCount = jest.fn().mockResolvedValue(0);

        const moduleRef = await Test.createTestingModule({
            providers: [
                ProductService,
                { provide: getConnectionToken(), useValue: {} },
                {
                    provide: getModelToken(Product.name),
                    useValue: {
                        find,
                        countDocuments,
                        estimatedDocumentCount,
                    },
                },
                { provide: InventoryService, useValue: {} },
                { provide: EanCounterService, useValue: {} },
            ],
        }).compile();

        service = moduleRef.get(ProductService);
    });

    it('counts exactly, never by the collection estimate, with no search (#16)', async () => {
        countDocuments.mockResolvedValue(12);

        const result = await service.getAll({ page: 1, limit: 5 } as GetAllDto);

        expect(countDocuments).toHaveBeenCalledWith({});
        expect(estimatedDocumentCount).not.toHaveBeenCalled();
        expect(result.totalItems).toBe(12);
    });

    it('matches the name anywhere and the barcode as a prefix, literally', async () => {
        await service.getAll({
            page: 1,
            limit: 5,
            name: 'c++ milk',
            EAN: '480',
        } as GetAllDto);

        expect(find.mock.calls[0][0]).toEqual({
            name: { $regex: 'c\\+\\+ milk' },
            EAN: { $regex: '^480' },
        });
    });
});
