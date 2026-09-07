import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ClientSession } from 'mongoose';
import { InventoryService } from './inventory.service';
import { Inventory } from './inventory.schema';
import { ProductService } from '../../product/product.service';
import { ValidationError } from '../../common/errors';
import { PaymentType, SellDto } from '../../sales/types';

/** Chainable stand-in for `find().populate().session().lean()`. */
function leanChain(rows: unknown[]) {
    const chain = {
        populate: () => chain,
        session: () => chain,
        lean: () => Promise.resolve(rows),
    };
    return chain;
}

function sellDto(details: { product: string; quantity: number }[]): SellDto {
    return {
        paymentType: PaymentType.CASH,
        sellDetails: details,
    } as SellDto;
}

describe('InventoryService.sell', () => {
    let service: InventoryService;
    let bulkWrite: jest.Mock;
    let find: jest.Mock;

    const session = {} as ClientSession;

    beforeEach(async () => {
        bulkWrite = jest.fn();
        find = jest.fn();

        const moduleRef = await Test.createTestingModule({
            providers: [
                InventoryService,
                {
                    provide: getModelToken(Inventory.name),
                    useValue: { bulkWrite, find },
                },
                { provide: ProductService, useValue: {} },
            ],
        }).compile();

        service = moduleRef.get(InventoryService);
    });

    it('guards the decrement in the filter so stock cannot go negative', async () => {
        bulkWrite.mockResolvedValue({ matchedCount: 1 });

        await service.sell(sellDto([{ product: 'p1', quantity: 3 }]), session);

        const [operations] = bulkWrite.mock.calls[0] as [
            { updateOne: { filter: Record<string, unknown> } }[],
        ];

        // Mongoose `min` validators do not run on update operators, so the
        // only thing preventing an oversell is this filter condition.
        expect(operations[0].updateOne.filter).toEqual({
            product: 'p1',
            stock: { $gte: 3 },
        });
    });

    it('rejects an oversell and reports the shortfall per product', async () => {
        // Guarded update matched nothing: stock is below the requested quantity.
        bulkWrite.mockResolvedValue({ matchedCount: 0 });
        find.mockReturnValue(
            leanChain([{ product: { _id: 'p1', name: 'bread' }, stock: 2 }]),
        );

        const attempt = service.sell(
            sellDto([{ product: 'p1', quantity: 5 }]),
            session,
        );

        await expect(attempt).rejects.toBeInstanceOf(ValidationError);
        await expect(attempt).rejects.toMatchObject({
            statusCode: 400,
            details: [
                { product: 'p1', name: 'bread', requested: 5, available: 2 },
            ],
        });
    });

    it('reports only the products that are actually short', async () => {
        bulkWrite.mockResolvedValue({ matchedCount: 1 });
        find.mockReturnValue(
            leanChain([
                { product: { _id: 'p1', name: 'bread' }, stock: 10 },
                { product: { _id: 'p2', name: 'milk' }, stock: 1 },
            ]),
        );

        const attempt = service.sell(
            sellDto([
                { product: 'p1', quantity: 2 },
                { product: 'p2', quantity: 4 },
            ]),
            session,
        );

        await expect(attempt).rejects.toMatchObject({
            details: [
                { product: 'p2', name: 'milk', requested: 4, available: 1 },
            ],
        });
    });

    it('treats an unknown product as zero available rather than throwing', async () => {
        bulkWrite.mockResolvedValue({ matchedCount: 0 });
        find.mockReturnValue(leanChain([]));

        await expect(
            service.sell(sellDto([{ product: 'ghost', quantity: 1 }]), session),
        ).rejects.toMatchObject({
            details: [{ product: 'ghost', requested: 1, available: 0 }],
        });
    });
});
