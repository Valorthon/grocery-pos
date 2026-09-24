import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { ClientSession } from 'mongoose';
import { SalesService } from './sales.service';
import { Sales } from './sales.schema';
import { SalesDetails } from './sales-details.schema';
import { ProductService } from '../product/product.service';
import { InventoryService } from '../inventory-man/inventory/inventory.service';
import { ValidationError } from '../common/errors';
import { PaymentType, SellDto } from './types';
import { AuthUser } from '../auth/types';
import { Role } from '@grocery-pos/contracts';

const CASHIER: AuthUser = {
    userId: 'u1',
    username: 'admin',
    roles: [Role.Admin],
};

function sellDto(details: { product: string; quantity: number }[]): SellDto {
    return { paymentType: PaymentType.CASH, sellDetails: details } as SellDto;
}

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
});
