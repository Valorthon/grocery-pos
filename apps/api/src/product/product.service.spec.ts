import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import mongoose, { ClientSession } from 'mongoose';
import { escapeRegex, MAX_MATCHES, ProductService } from './product.service';
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

    it('runs schema validators on every price update', async () => {
        // bulkWrite would skip them, letting a fractional price through.
        await service.update({
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
