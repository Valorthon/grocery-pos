import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import mongoose, { ClientSession } from 'mongoose';
import { ProductService } from './product.service';
import { Product, ProductSchema } from './product.schema';
import { InventoryService } from '../inventory-man/inventory/inventory.service';
import { EanCounterService } from '../ean-counter/ean-counter.service';
import { UpdateBulkDto } from './types';

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
