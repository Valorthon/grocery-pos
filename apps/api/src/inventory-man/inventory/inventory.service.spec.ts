import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ClientSession, PipelineStage, Types } from 'mongoose';
import { InventoryService, inventoryListPipeline } from './inventory.service';
import { Inventory } from './inventory.schema';
import { ProductService } from '../../product/product.service';
import {
    ErrorCode,
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

/** The acting user; every stock write records it as `updatedBy`. */
const ACTOR = '507f1f77bcf86cd799439077';
const ACTOR_ID = new Types.ObjectId(ACTOR);

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
        find.mockReturnValue(leanChain([]));
        bulkWrite.mockResolvedValue({ matchedCount: 1 });

        await service.sell(
            ACTOR,
            sellDto([{ product: 'p1', quantity: 3 }]),
            session,
        );

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
            ACTOR,
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
            ACTOR,
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

    it('reports pre-sale stock when an earlier line succeeded', async () => {
        // p1 6 of 10 applies; p2 20 of 5 is blocked. p1 must not be listed.
        find.mockReturnValue(
            leanChain([
                { product: { _id: 'p1', name: 'bread' }, stock: 10 },
                { product: { _id: 'p2', name: 'milk' }, stock: 5 },
            ]),
        );
        bulkWrite.mockResolvedValue({ matchedCount: 1 });

        await expect(
            service.sell(
                ACTOR,
                sellDto([
                    { product: 'p1', quantity: 6 },
                    { product: 'p2', quantity: 20 },
                ]),
                session,
            ),
        ).rejects.toMatchObject({
            details: [{ product: 'p2', requested: 20, available: 5 }],
        });
        expect(find.mock.invocationCallOrder[0]).toBeLessThan(
            bulkWrite.mock.invocationCallOrder[0],
        );
    });

    it('sums repeated lines for one product into a single guarded decrement', async () => {
        find.mockReturnValue(
            leanChain([{ product: { _id: 'p1', name: 'bread' }, stock: 10 }]),
        );
        bulkWrite.mockResolvedValue({ matchedCount: 0 });

        await expect(
            service.sell(
                ACTOR,
                sellDto([
                    { product: 'p1', quantity: 6 },
                    { product: 'p1', quantity: 6 },
                ]),
                session,
            ),
        ).rejects.toMatchObject({
            details: [{ product: 'p1', requested: 12, available: 10 }],
        });

        const [operations] = bulkWrite.mock.calls[0] as [
            { updateOne: { filter: Record<string, unknown> } }[],
        ];
        expect(operations.map((op) => op.updateOne.filter)).toEqual([
            { product: 'p1', stock: { $gte: 12 } },
        ]);
    });

    it('treats an unknown product as zero available rather than throwing', async () => {
        bulkWrite.mockResolvedValue({ matchedCount: 0 });
        find.mockReturnValue(leanChain([]));

        await expect(
            service.sell(
                ACTOR,
                sellDto([{ product: 'ghost', quantity: 1 }]),
                session,
            ),
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

    /** Stock as it stands before the request, which is what find() returns. */
    function stock(rows: Record<string, number>) {
        find.mockReturnValue(
            leanChain(
                Object.entries(rows).map(([id, value]) => ({
                    product: { _id: id, name: `name-${id}` },
                    stock: value,
                })),
            ),
        );
    }

    function operations() {
        const [ops] = bulkWrite.mock.calls[0] as [
            {
                updateOne: {
                    filter: Record<string, unknown>;
                    update: Record<string, unknown>;
                };
            }[],
        ];
        return ops.map((op) => op.updateOne);
    }

    it('guards negative changes in the filter and leaves positive ones unguarded', async () => {
        stock({ p1: 10, p2: 0 });
        bulkWrite.mockResolvedValue({ matchedCount: 2 });

        await service.adjust(
            ACTOR,
            adjustDto([
                { product: 'p1', change: -4 },
                { product: 'p2', change: 7 },
            ]),
            session,
        );

        expect(operations().map((op) => op.filter)).toEqual([
            { product: 'p1', stock: { $gte: 4 } },
            { product: 'p2' },
        ]);
    });

    it('reads stock before writing so shortfalls reflect the pre-request state', async () => {
        stock({ p1: 10 });
        bulkWrite.mockResolvedValue({ matchedCount: 1 });

        await service.adjust(
            ACTOR,
            adjustDto([{ product: 'p1', change: -1 }]),
            session,
        );

        expect(find.mock.invocationCallOrder[0]).toBeLessThan(
            bulkWrite.mock.invocationCallOrder[0],
        );
    });

    it('rejects a change that would drive stock negative, leaving stock untouched', async () => {
        // Stock is 10: the guarded filter matches nothing, so no $inc applies.
        stock({ p1: 10 });
        bulkWrite.mockResolvedValue({ matchedCount: 0 });

        const attempt = service.adjust(
            ACTOR,
            adjustDto([{ product: 'p1', change: -999999 }]),
            session,
        );

        await expect(attempt).rejects.toBeInstanceOf(ValidationError);
        await expect(attempt).rejects.toMatchObject({
            statusCode: 400,
            details: [
                {
                    product: 'p1',
                    name: 'name-p1',
                    change: -999999,
                    available: 10,
                },
            ],
        });
        expect(operations().map((op) => op.filter)).toEqual([
            { product: 'p1', stock: { $gte: 999999 } },
        ]);
    });

    it('lists only the failing product when an earlier line succeeded', async () => {
        // p1 -6 vs 10 applies; p2 -20 vs 5 is blocked by its guard.
        stock({ p1: 10, p2: 5 });
        bulkWrite.mockResolvedValue({ matchedCount: 1 });

        await expect(
            service.adjust(
                ACTOR,
                adjustDto([
                    { product: 'p1', change: -6 },
                    { product: 'p2', change: -20 },
                ]),
                session,
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            details: [{ product: 'p2', change: -20, available: 5 }],
        });
    });

    it('nets repeated lines for one product into a single guarded op', async () => {
        // -5 then -6 against 10 is a net -11: rejected, available still 10.
        stock({ p1: 10 });
        bulkWrite.mockResolvedValue({ matchedCount: 0 });

        await expect(
            service.adjust(
                ACTOR,
                adjustDto([
                    { product: 'p1', change: -5 },
                    { product: 'p1', change: -6 },
                ]),
                session,
            ),
        ).rejects.toMatchObject({
            details: [{ product: 'p1', change: -11, available: 10 }],
        });
        expect(operations()).toEqual([
            {
                filter: { product: 'p1', stock: { $gte: 11 } },
                update: {
                    $inc: { stock: -11 },
                    $set: { updatedBy: ACTOR_ID },
                },
            },
        ]);
    });

    it('accepts lines whose net is positive regardless of their order', async () => {
        // -3 then +5 against 0 is a net +2, the same as +5 then -3.
        stock({ p1: 0 });
        bulkWrite.mockResolvedValue({ matchedCount: 1 });

        await expect(
            service.adjust(
                ACTOR,
                adjustDto([
                    { product: 'p1', change: -3 },
                    { product: 'p1', change: 5 },
                ]),
                session,
            ),
        ).resolves.toBeUndefined();
        expect(operations()).toEqual([
            {
                filter: { product: 'p1' },
                update: {
                    $inc: { stock: 2 },
                    $set: { updatedBy: ACTOR_ID },
                },
            },
        ]);
    });

    it('skips the write when every product nets to zero', async () => {
        stock({ p1: 4 });

        await service.adjust(
            ACTOR,
            adjustDto([
                { product: 'p1', change: 3 },
                { product: 'p1', change: -3 },
            ]),
            session,
        );

        expect(bulkWrite).not.toHaveBeenCalled();
    });

    it('rejects products with no inventory row or whose product is gone, before writing', async () => {
        find.mockReturnValue(
            leanChain([
                { product: { _id: 'p1', name: 'bread' }, stock: 10 },
                // Inventory row whose product document no longer exists.
                { product: null, stock: 4 },
            ]),
        );

        const attempt = service.adjust(
            ACTOR,
            adjustDto([
                { product: 'p1', change: 1 },
                { product: 'orphan', change: 1 },
                { product: 'ghost', change: 5 },
            ]),
            session,
        );

        await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
        await expect(attempt).rejects.toMatchObject({
            statusCode: 404,
            details: [{ product: 'orphan' }, { product: 'ghost' }],
        });
        expect(bulkWrite).not.toHaveBeenCalled();
    });

    describe('returnStock', () => {
        it('puts sold units back as one positive increment per product', async () => {
            stock({ p1: 0, p2: 4 });
            bulkWrite.mockResolvedValue({ matchedCount: 2 });

            await service.returnStock(
                ACTOR,
                [
                    { product: 'p1', quantity: 2 },
                    { product: 'p2', quantity: 3 },
                    { product: 'p1', quantity: 1 },
                ],
                session,
            );

            expect(operations()).toEqual([
                {
                    filter: { product: 'p1' },
                    update: {
                        $inc: { stock: 3 },
                        $set: { updatedBy: ACTOR_ID },
                    },
                },
                {
                    filter: { product: 'p2' },
                    update: {
                        $inc: { stock: 3 },
                        $set: { updatedBy: ACTOR_ID },
                    },
                },
            ]);
        });

        it('rejects with a 404 when a product has no inventory row', async () => {
            stock({ p1: 0 });

            await expect(
                service.returnStock(
                    ACTOR,
                    [
                        { product: 'p1', quantity: 1 },
                        { product: 'gone', quantity: 1 },
                    ],
                    session,
                ),
            ).rejects.toBeInstanceOf(NotFoundError);
            expect(bulkWrite).not.toHaveBeenCalled();
        });
    });
});

describe('InventoryService.restock', () => {
    let service: InventoryService;
    let bulkWrite: jest.Mock;
    let getMany: jest.Mock;
    let createMany: jest.Mock;

    const session = {} as ClientSession;
    const user: AuthUser = {
        userId: '507f1f77bcf86cd799439099',
        username: 'admin',
        roles: [Role.Admin],
    };
    const EXISTING = '507f1f77bcf86cd799439011';
    const dto = {
        restockDetails: [{ product: EXISTING, quantity: 3, unitCost: 1000 }],
    } as RestockDto;

    beforeEach(async () => {
        bulkWrite = jest.fn();
        // Every id asked for exists, unless a test says otherwise.
        getMany = jest.fn((ids: string[]) =>
            Promise.resolve(new Map(ids.map((id) => [id, { _id: id }]))),
        );
        createMany = jest.fn().mockResolvedValue([]);

        const moduleRef = await Test.createTestingModule({
            providers: [
                InventoryService,
                {
                    provide: getModelToken(Inventory.name),
                    useValue: { bulkWrite },
                },
                {
                    provide: ProductService,
                    useValue: { getMany, createMany },
                },
            ],
        }).compile();

        service = moduleRef.get(InventoryService);
    });

    function operations() {
        const [ops] = bulkWrite.mock.calls[0] as [
            {
                updateOne: {
                    filter: Record<string, unknown>;
                    update: Record<string, unknown>;
                    upsert: boolean;
                };
            }[],
        ];
        return ops.map((op) => op.updateOne);
    }

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

    describe('unknown products (issue #14)', () => {
        const GHOST = '507f1f77bcf86cd799439022';

        it('rejects a product id that does not exist with a 404, before writing', async () => {
            getMany.mockResolvedValue(new Map([[EXISTING, {}]]));

            const attempt = service.restock(
                user,
                {
                    restockDetails: [
                        { product: EXISTING, quantity: 1, unitCost: 100 },
                        { product: GHOST, quantity: 2, unitCost: 100 },
                    ],
                } as RestockDto,
                session,
            );

            await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
            await expect(attempt).rejects.toMatchObject({
                statusCode: 404,
                code: ErrorCode.PRODUCT_NOT_FOUND,
                details: [{ index: 1, product: GHOST }],
            });
            // No orphan upsert, and no product (or EAN) spent on the way.
            expect(bulkWrite).not.toHaveBeenCalled();
            expect(createMany).not.toHaveBeenCalled();
        });

        it('checks existence inside the transaction', async () => {
            bulkWrite.mockResolvedValue({ matchedCount: 1, upsertedCount: 0 });

            await service.restock(user, dto, session);

            expect(getMany).toHaveBeenCalledWith([EXISTING], session);
        });

        it('accepts an upper-case hex id for a product that exists', async () => {
            // getMany keys by `_id.toString()`, which is lower case.
            getMany.mockResolvedValue(new Map([[EXISTING, {}]]));
            bulkWrite.mockResolvedValue({ matchedCount: 1, upsertedCount: 0 });

            await expect(
                service.restock(
                    user,
                    {
                        restockDetails: [
                            {
                                product: EXISTING.toUpperCase(),
                                quantity: 1,
                                unitCost: 100,
                            },
                        ],
                    } as RestockDto,
                    session,
                ),
            ).resolves.toHaveLength(1);
        });
    });

    it('matches new products to their lines by position, not by EAN', async () => {
        const created = [new Types.ObjectId(), new Types.ObjectId()];
        createMany.mockResolvedValue(created);
        bulkWrite.mockResolvedValue({ matchedCount: 1, upsertedCount: 2 });

        const lines = await service.restock(
            user,
            {
                restockDetails: [
                    // No EAN: the server generates one without writing it
                    // back into this DTO.
                    {
                        newProduct: { name: 'a', price: 100 },
                        quantity: 1,
                        unitCost: 50,
                    },
                    { product: EXISTING, quantity: 2, unitCost: 50 },
                    {
                        newProduct: {
                            name: 'b',
                            price: 100,
                            EAN: '4006381333931',
                        },
                        quantity: 3,
                        unitCost: 50,
                    },
                ],
            } as RestockDto,
            session,
        );

        expect(createMany).toHaveBeenCalledWith(
            [
                { name: 'a', price: 100 },
                { name: 'b', price: 100, EAN: '4006381333931' },
            ],
            session,
        );
        expect(lines.map((line) => line.product.toString())).toEqual([
            created[0].toString(),
            EXISTING,
            created[1].toString(),
        ]);
    });

    it('records the restocker as updatedBy on every write, not only on insert', async () => {
        bulkWrite.mockResolvedValue({ matchedCount: 1, upsertedCount: 0 });

        await service.restock(user, dto, session);

        const product = new Types.ObjectId(EXISTING);
        expect(operations()).toEqual([
            {
                filter: { product },
                update: {
                    $inc: { stock: 3 },
                    $set: { updatedBy: new Types.ObjectId(user.userId) },
                    $setOnInsert: { product },
                },
                upsert: true,
            },
        ]);
    });
});

describe('InventoryService stock writes record updatedBy (issue #14)', () => {
    let service: InventoryService;
    let bulkWrite: jest.Mock;
    let find: jest.Mock;

    const session = {} as ClientSession;

    beforeEach(async () => {
        bulkWrite = jest.fn().mockResolvedValue({ matchedCount: 1 });
        find = jest
            .fn()
            .mockReturnValue(
                leanChain([
                    { product: { _id: 'p1', name: 'bread' }, stock: 10 },
                ]),
            );

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

    function updates() {
        const [ops] = bulkWrite.mock.calls[0] as [
            { updateOne: { update: Record<string, unknown> } }[],
        ];
        return ops.map((op) => op.updateOne.update);
    }

    it('on a sale', async () => {
        await service.sell(
            ACTOR,
            sellDto([{ product: 'p1', quantity: 2 }]),
            session,
        );

        expect(updates()).toEqual([
            { $inc: { stock: -2 }, $set: { updatedBy: ACTOR_ID } },
        ]);
    });

    it('on an adjustment', async () => {
        await service.adjust(
            ACTOR,
            adjustDto([{ product: 'p1', change: -1 }]),
            session,
        );

        expect(updates()).toEqual([
            { $inc: { stock: -1 }, $set: { updatedBy: ACTOR_ID } },
        ]);
    });

    it('on a void or refund putting stock back', async () => {
        await service.returnStock(
            ACTOR,
            [{ product: 'p1', quantity: 4 }],
            session,
        );

        expect(updates()).toEqual([
            { $inc: { stock: 4 }, $set: { updatedBy: ACTOR_ID } },
        ]);
    });
});

describe('InventoryService.getAll (issue #14)', () => {
    let service: InventoryService;
    let aggregate: jest.Mock;

    beforeEach(async () => {
        aggregate = jest.fn();

        const moduleRef = await Test.createTestingModule({
            providers: [
                InventoryService,
                {
                    provide: getModelToken(Inventory.name),
                    useValue: { aggregate },
                },
                { provide: ProductService, useValue: {} },
            ],
        }).compile();

        service = moduleRef.get(InventoryService);
    });

    const page = { page: 2, limit: 5 };

    function stage(pipeline: PipelineStage[], key: string) {
        return pipeline.filter((s) => key in s);
    }

    it('filters on maxStock 0 instead of listing the whole catalogue', () => {
        const pipeline = inventoryListPipeline({ ...page, maxStock: 0 });

        expect(pipeline[0]).toEqual({ $match: { stock: { $lte: 0 } } });
    });

    it('has no stock filter when maxStock is absent', () => {
        const pipeline = inventoryListPipeline({ ...page });

        expect(stage(pipeline, '$match')).toEqual([]);
    });

    it('drops orphans before counting, and counts through the same pipeline as the page', () => {
        const pipeline = inventoryListPipeline({ ...page, maxStock: 3 });

        const unwindAt = pipeline.findIndex((s) => '$unwind' in s);
        const facetAt = pipeline.findIndex((s) => '$facet' in s);
        // A plain $unwind (no preserveNullAndEmptyArrays) drops rows whose
        // product is gone; the count is a branch of the same $facet.
        expect(pipeline[unwindAt]).toEqual({ $unwind: '$product' });
        expect(unwindAt).toBeLessThan(facetAt);
        expect(facetAt).toBe(pipeline.length - 1);
        expect(pipeline[facetAt]).toEqual({
            $facet: {
                metadata: [{ $count: 'total' }],
                data: [
                    { $sort: { 'product.name': 1, _id: 1 } },
                    { $skip: 5 },
                    { $limit: 5 },
                ],
            },
        });
    });

    it('searches names anywhere and barcodes by prefix, after the join', () => {
        const pipeline = inventoryListPipeline({
            ...page,
            name: 'c++ (1',
            EAN: '480',
        });

        expect(stage(pipeline, '$match')).toEqual([
            {
                $match: {
                    'product.name': { $regex: 'c\\+\\+ \\(1' },
                    'product.EAN': { $regex: '^480' },
                },
            },
        ]);
        expect(pipeline.findIndex((s) => '$match' in s)).toBeGreaterThan(
            pipeline.findIndex((s) => '$unwind' in s),
        );
    });

    it('returns the page in pipeline order with the facet count', async () => {
        const rows = [
            { product: { name: 'apple' }, stock: 1 },
            { product: { name: 'bread' }, stock: 0 },
        ];
        aggregate.mockResolvedValue([{ data: rows, metadata: [{ total: 7 }] }]);

        await expect(service.getAll({ ...page, maxStock: 1 })).resolves.toEqual(
            { data: rows, totalItems: 7 },
        );
        expect(aggregate).toHaveBeenCalledWith(
            inventoryListPipeline({ ...page, maxStock: 1 }),
        );
    });

    it('returns an empty page and zero when nothing matches', async () => {
        aggregate.mockResolvedValue([{ data: [], metadata: [] }]);

        await expect(service.getAll({ ...page })).resolves.toEqual({
            data: [],
            totalItems: 0,
        });
    });
});
