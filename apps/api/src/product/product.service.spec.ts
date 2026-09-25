import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import mongoose, { ClientSession } from 'mongoose';
import {
    assertMayChangePrices,
    escapeRegex,
    MAX_MATCHES,
    ProductService,
} from './product.service';
import { Role, type AuthUser } from '../auth/types';
import { ErrorCode, ForbiddenError } from '../common/errors';
import { Product, ProductSchema } from './product.schema';
import { InventoryService } from '../inventory-man/inventory/inventory.service';
import { EanCounterService } from '../ean-counter/ean-counter.service';
import { MatchesDto, UpdateBulkDto } from './types';

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

describe('escapeRegex', () => {
    it.each([
        '(',
        '*',
        '+',
        'a.b',
        '[x]',
        'c++',
        '^$',
        'a|b',
        '\\',
        '{2}',
        '?',
    ])('makes %p match only itself', (input) => {
        const pattern = new RegExp(escapeRegex(input));

        expect(pattern.test(input)).toBe(true);
        expect(pattern.test('zzz')).toBe(false);
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
