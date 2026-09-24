import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ClientSession } from 'mongoose';
import { InventoryService } from './inventory.service';
import { Inventory } from './inventory.schema';
import { ProductService } from '../../product/product.service';
import {
    InternalError,
    NotFoundError,
    ValidationError,
} from '../../common/errors';
import { PaymentType, SellDto } from '../../sales/types';
import { AdjustDto } from '../adjustment/types';
import { RestockDto } from '../restock/types';
import { AuthUser } from '../../auth/types';
import { Role } from '@grocery-pos/contracts';

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

function adjustDto(details: { product: string; change: number }[]): AdjustDto {
    return {
        description: 'stock count',
        adjustDetails: details.map((d) => ({ ...d, reason: 'recount' })),
    } as AdjustDto;
}

describe('InventoryService.adjust', () => {
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

    function filters() {
        const [operations] = bulkWrite.mock.calls[0] as [
            { updateOne: { filter: Record<string, unknown> } }[],
        ];
        return operations.map((op) => op.updateOne.filter);
    }

    it('guards negative changes in the filter and leaves positive ones unguarded', async () => {
        bulkWrite.mockResolvedValue({ matchedCount: 2 });

        await service.adjust(
            adjustDto([
                { product: 'p1', change: -4 },
                { product: 'p2', change: 7 },
            ]),
            session,
        );

        expect(filters()).toEqual([
            { product: 'p1', stock: { $gte: 4 } },
            { product: 'p2' },
        ]);
    });

    it('rejects a change that would drive stock negative, leaving stock untouched', async () => {
        // Stock is 10: the guarded filter matches nothing, so no $inc applies.
        bulkWrite.mockResolvedValue({ matchedCount: 0 });
        find.mockReturnValue(
            leanChain([{ product: { _id: 'p1', name: 'bread' }, stock: 10 }]),
        );

        const attempt = service.adjust(
            adjustDto([{ product: 'p1', change: -999999 }]),
            session,
        );

        await expect(attempt).rejects.toBeInstanceOf(ValidationError);
        await expect(attempt).rejects.toMatchObject({
            statusCode: 400,
            details: [
                {
                    product: 'p1',
                    name: 'bread',
                    change: -999999,
                    available: 10,
                },
            ],
        });
        expect(filters()).toEqual([{ product: 'p1', stock: { $gte: 999999 } }]);
    });

    it('rejects an adjustment for a product with no inventory row', async () => {
        bulkWrite.mockResolvedValue({ matchedCount: 0 });
        find.mockReturnValue(leanChain([]));

        const attempt = service.adjust(
            adjustDto([{ product: 'ghost', change: 5 }]),
            session,
        );

        await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
        await expect(attempt).rejects.toMatchObject({
            statusCode: 404,
            details: [{ product: 'ghost' }],
        });
    });
});

describe('InventoryService.assertAdjustable', () => {
    let service: InventoryService;
    let find: jest.Mock;

    const session = {} as ClientSession;

    beforeEach(async () => {
        find = jest.fn();

        const moduleRef = await Test.createTestingModule({
            providers: [
                InventoryService,
                {
                    provide: getModelToken(Inventory.name),
                    useValue: { find },
                },
                { provide: ProductService, useValue: {} },
            ],
        }).compile();

        service = moduleRef.get(InventoryService);
    });

    it('passes when every product has an inventory row', async () => {
        find.mockReturnValue(
            leanChain([{ product: { _id: 'p1', name: 'bread' }, stock: 10 }]),
        );

        await expect(
            service.assertAdjustable(
                adjustDto([{ product: 'p1', change: -3 }]).adjustDetails,
                session,
            ),
        ).resolves.toBeUndefined();
    });

    it('rejects products with no inventory row or whose product is gone', async () => {
        find.mockReturnValue(
            leanChain([
                { product: { _id: 'p1', name: 'bread' }, stock: 10 },
                // Inventory row whose product document no longer exists.
                { product: null, stock: 4 },
            ]),
        );

        await expect(
            service.assertAdjustable(
                adjustDto([
                    { product: 'p1', change: 1 },
                    { product: 'orphan', change: 1 },
                    { product: 'ghost', change: 1 },
                ]).adjustDetails,
                session,
            ),
        ).rejects.toMatchObject({
            statusCode: 404,
            details: [{ product: 'orphan' }, { product: 'ghost' }],
        });
    });
});

describe('InventoryService.restock', () => {
    let service: InventoryService;
    let bulkWrite: jest.Mock;

    const session = {} as ClientSession;
    const user: AuthUser = {
        userId: '507f1f77bcf86cd799439099',
        username: 'admin',
        roles: [Role.Admin],
    };
    const dto = {
        restockDetails: [
            {
                product: '507f1f77bcf86cd799439011',
                quantity: 3,
                unitCost: 1000,
            },
        ],
    } as RestockDto;

    beforeEach(async () => {
        bulkWrite = jest.fn();

        const moduleRef = await Test.createTestingModule({
            providers: [
                InventoryService,
                {
                    provide: getModelToken(Inventory.name),
                    useValue: { bulkWrite },
                },
                {
                    provide: ProductService,
                    useValue: { createMany: jest.fn().mockResolvedValue({}) },
                },
            ],
        }).compile();

        service = moduleRef.get(InventoryService);
    });

    it('accepts a write that matched an existing row', async () => {
        bulkWrite.mockResolvedValue({ matchedCount: 1, upsertedCount: 0 });

        await expect(service.restock(user, dto, session)).resolves.toHaveLength(
            1,
        );
    });

    it('accepts a write that upserted a new row', async () => {
        bulkWrite.mockResolvedValue({ matchedCount: 0, upsertedCount: 1 });

        await expect(service.restock(user, dto, session)).resolves.toHaveLength(
            1,
        );
    });

    it('throws when a write neither matched nor upserted', async () => {
        bulkWrite.mockResolvedValue({ matchedCount: 0, upsertedCount: 0 });

        await expect(
            service.restock(user, dto, session),
        ).rejects.toBeInstanceOf(InternalError);
    });
});
