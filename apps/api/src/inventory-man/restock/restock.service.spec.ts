import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { RestockService } from './restock.service';
import { Restock } from './restock.schema';
import mongoose from 'mongoose';
import { RestockDetails, RestockDetailsSchema } from './restock-details.schema';
import { InventoryService } from '../inventory/inventory.service';
import { ProductService } from '../../product/product.service';
import { TypedConfigService } from '../../common/typed-config/typed-config.service';
import { GetAllDto, RestockDto } from './types';
import { AuthUser } from '../../auth/types';

describe('RestockService.getAll date filter', () => {
    let service: RestockService;
    let find: jest.Mock;
    let countDocuments: jest.Mock;

    beforeEach(async () => {
        const chain = {
            sort: () => chain,
            skip: () => chain,
            limit: () => chain,
            populate: () => chain,
            lean: () => Promise.resolve([]),
        };
        find = jest.fn().mockReturnValue(chain);
        countDocuments = jest.fn().mockResolvedValue(0);

        const moduleRef = await Test.createTestingModule({
            providers: [
                RestockService,
                { provide: getConnectionToken(), useValue: {} },
                {
                    provide: getModelToken(Restock.name),
                    useValue: { find, countDocuments },
                },
                { provide: getModelToken(RestockDetails.name), useValue: {} },
                { provide: InventoryService, useValue: {} },
                { provide: ProductService, useValue: {} },
                {
                    provide: TypedConfigService,
                    useValue: { get: () => 'Asia/Manila' },
                },
            ],
        }).compile();

        service = moduleRef.get(RestockService);
    });

    function query(): Record<string, unknown> {
        return find.mock.calls[0][0] as Record<string, unknown>;
    }

    it('bounds both ends by whole Manila days', async () => {
        await service.getAll({
            page: 1,
            limit: 5,
            dateFrom: '2026-01-05',
            dateTo: '2026-01-05',
        } as GetAllDto);

        expect(query().createdAt).toEqual({
            $gte: new Date('2026-01-04T16:00:00.000Z'),
            $lt: new Date('2026-01-05T16:00:00.000Z'),
        });
        expect(countDocuments).toHaveBeenCalledWith(query());
    });

    it('applies a start-only range', async () => {
        await service.getAll({
            page: 1,
            limit: 5,
            dateFrom: '2026-01-05',
        } as GetAllDto);

        expect(query().createdAt).toEqual({
            $gte: new Date('2026-01-04T16:00:00.000Z'),
        });
    });

    it('applies an end-only range', async () => {
        await service.getAll({
            page: 1,
            limit: 5,
            dateTo: '2026-01-05',
        } as GetAllDto);

        expect(query().createdAt).toEqual({
            $lt: new Date('2026-01-05T16:00:00.000Z'),
        });
    });

    it('omits the date filter when no dates are given', async () => {
        await service.getAll({ page: 1, limit: 5 } as GetAllDto);

        expect(query()).not.toHaveProperty('createdAt');
    });

    it('does not mutate the DTO', async () => {
        const dto = Object.freeze({
            page: 1,
            limit: 5,
            dateFrom: '2026-01-05',
            dateTo: '2026-01-06',
        }) as GetAllDto;
        const snapshot = { ...dto };

        await service.getAll(dto);

        expect(dto).toEqual(snapshot);
    });
});

describe('RestockDetails schema quantity (issue #14)', () => {
    const DetailsModel = mongoose.model(
        RestockDetails.name,
        RestockDetailsSchema,
    );

    function quantityError(quantity: number) {
        const doc = new DetailsModel({
            restock: new mongoose.Types.ObjectId(),
            product: new mongoose.Types.ObjectId(),
            quantity,
            unitCost: 100,
        });
        return doc.validateSync()?.errors.quantity?.kind;
    }

    it('accepts a whole quantity', () => {
        expect(quantityError(3)).toBeUndefined();
    });

    it('rejects a fractional quantity, as SalesDetails does', () => {
        expect(quantityError(1.5)).toBe('user defined');
    });
});

describe('RestockService.restock (issue #30)', () => {
    const USER = {
        userId: '507f1f77bcf86cd799439099',
        username: 'rita',
        roles: [],
    } as unknown as AuthUser;
    const P1 = '507f1f77bcf86cd799439011';
    const P2 = '507f1f77bcf86cd799439012';

    let service: RestockService;
    let calls: string[];
    let create: jest.Mock;
    let bulkWrite: jest.Mock;
    let inventoryRestock: jest.Mock;

    beforeEach(async () => {
        calls = [];
        inventoryRestock = jest.fn(async () => {
            calls.push('inventory');
            return [
                { product: P1, quantity: 3, unitCost: 1999 },
                { product: P2, quantity: 2, unitCost: 3505 },
            ];
        });
        create = jest.fn(async () => {
            calls.push('restock');
            return [{ _id: 'restock1' }];
        });
        bulkWrite = jest.fn(async () => {
            calls.push('details');
        });
        const session = {
            withTransaction: async (fn: (s: unknown) => unknown) => fn({}),
            endSession: jest.fn(),
        };

        const moduleRef = await Test.createTestingModule({
            providers: [
                RestockService,
                {
                    provide: getConnectionToken(),
                    useValue: { startSession: () => Promise.resolve(session) },
                },
                { provide: getModelToken(Restock.name), useValue: { create } },
                {
                    provide: getModelToken(RestockDetails.name),
                    useValue: { bulkWrite },
                },
                {
                    provide: InventoryService,
                    useValue: { restock: inventoryRestock },
                },
                { provide: ProductService, useValue: {} },
                { provide: TypedConfigService, useValue: { get: () => '' } },
            ],
        }).compile();
        service = moduleRef.get(RestockService);
    });

    const DTO = {
        description: 'delivery',
        restockDetails: [
            { product: P1, quantity: 3, unitCost: 1999 },
            { product: P2, quantity: 2, unitCost: 3505 },
        ],
    } as unknown as RestockDto;

    it('records the exact total cost in centavos: sum of quantity x unit cost', async () => {
        // 3 x 19.99 + 2 x 35.05 = 130.07. In pesos as floats this is
        // 130.07000000000002; integer centavos keep it exact (#1).
        await service.restock(USER, DTO);
        expect(create).toHaveBeenCalledWith(
            [
                {
                    description: 'delivery',
                    restockedBy: USER.userId,
                    totalCost: 13_007,
                },
            ],
            expect.anything(),
        );
    });

    it('applies the stock first, then writes the restock and one detail row per line', async () => {
        // Stock changes are the part that can be refused (unknown
        // product); the records must only follow a successful change.
        await service.restock(USER, DTO);
        expect(calls).toEqual(['inventory', 'restock', 'details']);
        expect(bulkWrite).toHaveBeenCalledWith(
            [
                {
                    insertOne: {
                        document: {
                            restock: 'restock1',
                            product: P1,
                            quantity: 3,
                            unitCost: 1999,
                        },
                    },
                },
                {
                    insertOne: {
                        document: {
                            restock: 'restock1',
                            product: P2,
                            quantity: 2,
                            unitCost: 3505,
                        },
                    },
                },
            ],
            expect.anything(),
        );
    });

    it('writes no restock record when the stock change is refused', async () => {
        inventoryRestock.mockRejectedValue(new Error('unknown product'));
        await expect(service.restock(USER, DTO)).rejects.toThrow();
        expect(create).not.toHaveBeenCalled();
        expect(bulkWrite).not.toHaveBeenCalled();
    });
});

describe('RestockService.getDetails (issue #30)', () => {
    let service: RestockService;
    let aggregate: jest.Mock;

    beforeEach(async () => {
        aggregate = jest.fn().mockResolvedValue([]);
        const moduleRef = await Test.createTestingModule({
            providers: [
                RestockService,
                { provide: getConnectionToken(), useValue: {} },
                { provide: getModelToken(Restock.name), useValue: {} },
                {
                    provide: getModelToken(RestockDetails.name),
                    useValue: { aggregate },
                },
                { provide: InventoryService, useValue: {} },
                { provide: ProductService, useValue: {} },
                { provide: TypedConfigService, useValue: { get: () => '' } },
            ],
        }).compile();
        service = moduleRef.get(RestockService);
    });

    const RESTOCK = '507f1f77bcf86cd799439011';

    it('matches the restock by ObjectId and pages after the product join', async () => {
        await service.getDetails({
            restock: RESTOCK,
            page: 3,
            limit: 20,
        } as never);
        const pipeline = aggregate.mock.calls[0][0] as Record<
            string,
            unknown
        >[];
        const match = pipeline[0].$match as {
            restock: mongoose.Types.ObjectId;
        };
        expect(match.restock).toBeInstanceOf(mongoose.Types.ObjectId);
        expect(match.restock.toString()).toBe(RESTOCK);
        const facet = pipeline.at(-1)!.$facet as {
            paginatedData: Record<string, unknown>[];
        };
        expect(facet.paginatedData).toEqual([
            { $sort: { 'product.name': 1, _id: 1 } },
            { $skip: 40 },
            { $limit: 20 },
        ]);
    });

    it('answers an empty page with totalItems 0 (not undefined)', async () => {
        await expect(
            service.getDetails({
                restock: RESTOCK,
                page: 1,
                limit: 10,
            } as never),
        ).resolves.toEqual({ data: [], totalItems: 0 });
    });

    it('reads the page and the count from the facet', async () => {
        aggregate.mockResolvedValue([
            { paginatedData: [{ _id: 'd1' }], metadata: [{ total: 11 }] },
        ]);
        await expect(
            service.getDetails({
                restock: RESTOCK,
                page: 2,
                limit: 10,
            } as never),
        ).resolves.toEqual({ data: [{ _id: 'd1' }], totalItems: 11 });
    });
});
