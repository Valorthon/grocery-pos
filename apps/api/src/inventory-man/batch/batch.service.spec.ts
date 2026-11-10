import { Model, Types, type ClientSession } from 'mongoose';
import { InventoryBatchService } from './batch.service';
import { InventoryBatch } from './batch.schema';
import { Product } from '../../product/product.schema';
import { Inventory } from '../inventory/inventory.schema';
import { TypedConfigService } from '../../common/typed-config/typed-config.service';
const product = new Types.ObjectId(),
    batch = new Types.ObjectId(),
    detail = new Types.ObjectId();
const session = {} as ClientSession;
function query(value: unknown) {
    const q = {
        select: jest.fn().mockReturnThis(),
        session: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(value),
    };
    return q;
}
let service: InventoryBatchService;
let batchModel: {
    init: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    updateOne: jest.Mock;
    countDocuments: jest.Mock;
};
let productModel: { findById: jest.Mock; distinct: jest.Mock },
    inventoryModel: { findOne: jest.Mock };
beforeEach(() => {
    batchModel = {
        init: jest.fn().mockResolvedValue(undefined),
        find: jest.fn(() => query([])),
        findOne: jest.fn(() => query({ _id: batch, remainingQty: 3 })),
        create: jest.fn().mockResolvedValue([]),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
        countDocuments: jest.fn().mockResolvedValue(0),
    };
    productModel = {
        findById: jest.fn(() => query({ tracksExpiry: true })),
        distinct: jest.fn().mockResolvedValue([]),
    };
    inventoryModel = { findOne: jest.fn(() => query({ stock: 0 })) };
    service = new InventoryBatchService(
        batchModel as unknown as Model<InventoryBatch>,
        productModel as unknown as Model<Product>,
        inventoryModel as unknown as Model<Inventory>,
        { get: () => 'Asia/Manila' } as unknown as TypedConfigService,
    );
});
it('waits for batch indexes and propagates initialization failure', async () => {
    await service.onModuleInit();
    expect(batchModel.init).toHaveBeenCalled();
    batchModel.init.mockRejectedValue(new Error('index'));
    await expect(service.onModuleInit()).rejects.toThrow('index');
});
it.each([
    ['2026-01-01T15:59:59Z', '2026-01-01'],
    ['2026-01-01T16:00:00Z', '2026-01-02'],
    ['2024-02-29T16:00:00Z', '2024-03-01'],
])('interprets store calendar day at %s', (at, expected) =>
    expect(service.today(new Date(at))).toBe(expected),
);
it('uses current time by default', () =>
    expect(service.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/));
it('ignores ordinary receipts without batch metadata', async () => {
    productModel.findById.mockReturnValue(query({}));
    await service.receive([{ _id: detail, product, quantity: 1 }], session);
    expect(batchModel.create).not.toHaveBeenCalled();
});
it.each([{ expiryDate: '2026-10-10' }, { batchNo: 'A' }])(
    'rejects ordinary receipt batch metadata %j',
    async (metadata) => {
        productModel.findById.mockReturnValue(query({ tracksExpiry: false }));
        await expect(
            service.receive(
                [{ _id: detail, product, quantity: 1, ...metadata }],
                session,
            ),
        ).rejects.toThrow('require an expiry-tracked');
    },
);
it('requires expiry for tracked receipt', async () =>
    await expect(
        service.receive([{ _id: detail, product, quantity: 1 }], session),
    ).rejects.toThrow('Expiry date is required'));
it.each([undefined, 'LOT-1'])(
    'creates linked dated receipt batch with number %s',
    async (batchNo) => {
        await service.receive(
            [
                {
                    _id: detail,
                    product,
                    quantity: 1,
                    expiryDate: '2026-10-10',
                    batchNo,
                },
            ],
            session,
        );
        expect(batchModel.create).toHaveBeenCalledWith(
            [
                expect.objectContaining({
                    product,
                    restockDetail: detail,
                    expiryDate: '2026-10-10',
                    receivedQty: 1,
                    remainingQty: 1,
                }),
            ],
            { session },
        );
    },
);
it('does not consume lots for untracked products', async () => {
    productModel.findById.mockReturnValue(query(null));
    expect(await service.consume(product, 2, session)).toEqual([]);
    expect(batchModel.find).not.toHaveBeenCalled();
});
it('consumes FEFO lots up to exact quantity without taking later rows', async () => {
    batchModel.find.mockReturnValue(
        query([
            { _id: batch, remainingQty: 2 },
            { _id: detail, remainingQty: 3 },
            { _id: product, remainingQty: 7 },
        ]),
    );
    expect(await service.consume(product, 4, session)).toEqual([
        { batch: String(batch), quantity: 2 },
        { batch: String(detail), quantity: 2 },
    ]);
    expect(batchModel.updateOne).toHaveBeenCalledTimes(2);
    expect(batchModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
            reconciliation: { $ne: true },
            expiryDate: { $gte: service.today() },
        }),
    );
});
it('rejects empty/insufficient unexpired supply', async () =>
    await expect(service.consume(product, 1, session)).rejects.toThrow(
        'Insufficient unexpired',
    ));
it('rejects a batch decrement lost to concurrent changes', async () => {
    batchModel.find.mockReturnValue(query([{ _id: batch, remainingQty: 2 }]));
    batchModel.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(service.consume(product, 1, session)).rejects.toThrow(
        'availability changed',
    );
});
it('skips batch restoration for untracked products', async () => {
    productModel.findById.mockReturnValue(query({}));
    await service.restore(product, 1, undefined, session);
    expect(batchModel.create).not.toHaveBeenCalled();
});
it('quarantines a legacy return rather than inventing expiry', async () => {
    await service.restore(product, 2, undefined, session);
    expect(batchModel.create).toHaveBeenCalledWith(
        [{ product, receivedQty: 2, remainingQty: 2, reconciliation: true }],
        { session },
    );
});
it('restores exact recorded allocations including now-expired lots', async () => {
    await service.restore(
        product,
        2,
        [{ batch: String(batch), quantity: 2 }],
        session,
    );
    expect(batchModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: batch, product }),
        { $inc: { remainingQty: 2 } },
        { session },
    );
});
it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects corrupt stored allocation quantity %s',
    async (quantity) =>
        await expect(
            service.restore(
                product,
                2,
                [{ batch: String(batch), quantity }],
                session,
            ),
        ).rejects.toThrow('Invalid stored batch allocation'),
);
it('rejects allocation sums overflowing safe integers', async () =>
    await expect(
        service.restore(
            product,
            2,
            [
                { batch: String(batch), quantity: Number.MAX_SAFE_INTEGER },
                { batch: String(detail), quantity: 1 },
            ],
            session,
        ),
    ).rejects.toThrow('Invalid stored batch allocation'));
it('rejects allocation sum differing from sold quantity', async () =>
    await expect(
        service.restore(
            product,
            3,
            [{ batch: String(batch), quantity: 2 }],
            session,
        ),
    ).rejects.toThrow('do not match sale quantity'));
it('rejects missing/overflowed return batch', async () => {
    batchModel.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(
        service.restore(
            product,
            2,
            [{ batch: String(batch), quantity: 2 }],
            session,
        ),
    ).rejects.toThrow('no longer exists');
});
it('allows untracked ordinary adjustments but rejects their batch field', async () => {
    productModel.findById.mockReturnValue(query({}));
    await service.adjust([{ product: String(product), change: 1 }], session);
    await expect(
        service.adjust(
            [{ product: String(product), batch: String(batch), change: 1 }],
            session,
        ),
    ).rejects.toThrow('require an expiry-tracked');
});
it('requires an explicit batch for tracked adjustments', async () =>
    await expect(
        service.adjust([{ product: String(product), change: -1 }], session),
    ).rejects.toThrow('Select a batch'));
it('rejects a batch belonging to another product', async () => {
    batchModel.findOne.mockReturnValue(query(null));
    await expect(
        service.adjust(
            [{ product: String(product), batch: String(batch), change: -1 }],
            session,
        ),
    ).rejects.toThrow('does not belong');
});
it.each([-4, Number.MAX_SAFE_INTEGER])(
    'rejects unsafe non-reconciliation adjustment %s',
    async (change) =>
        await expect(
            service.adjust(
                [{ product: String(product), batch: String(batch), change }],
                session,
            ),
        ).rejects.toThrow('exceeds available'),
);
it('writes a batch correction and then verifies aggregate equality', async () => {
    await service.adjust(
        [{ product: String(product), batch: String(batch), change: -1 }],
        session,
    );
    expect(batchModel.updateOne).toHaveBeenCalledWith(
        { _id: batch, remainingQty: 3 },
        { $inc: { remainingQty: -1 } },
        { session },
    );
});
it('allows negative reconciliation balance but not unsafe integer overflow', async () => {
    batchModel.findOne.mockReturnValue(
        query({ _id: batch, remainingQty: -2, reconciliation: true }),
    );
    await service.adjust(
        [{ product: String(product), batch: String(batch), change: -1 }],
        session,
    );
    await expect(
        service.adjust(
            [
                {
                    product: String(product),
                    batch: String(batch),
                    change: Number.MIN_SAFE_INTEGER,
                },
            ],
            session,
        ),
    ).rejects.toThrow('exceeds available');
});
it('rejects a concurrent adjustment that missed its expected value', async () => {
    batchModel.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(
        service.adjust(
            [{ product: String(product), batch: String(batch), change: -1 }],
            session,
        ),
    ).rejects.toThrow('availability changed');
});
it('leaves untracked offline receipts alone', async () => {
    productModel.findById.mockReturnValue(query({}));
    await service.reconcileOffline(product, 1, session);
    expect(batchModel.create).not.toHaveBeenCalled();
});
it('records legacy collected cash as explicit unallocated deficit', async () => {
    await service.reconcileOffline(product, 2, session);
    expect(batchModel.create).toHaveBeenCalledWith(
        [{ product, receivedQty: 0, remainingQty: -2, reconciliation: true }],
        { session },
    );
});
it('uses BigInt to compare the exact signed batch sum to aggregate', async () => {
    batchModel.find.mockReturnValue(
        query([{ remainingQty: 4 }, { remainingQty: -2 }]),
    );
    inventoryModel.findOne.mockReturnValue(query({ stock: 2 }));
    await service.assertInvariant(product, session);
});
it.each([null, { stock: 0.5 }, { stock: 1 }])(
    'rejects missing/corrupt/mismatched aggregate %j',
    async (inventory) => {
        inventoryModel.findOne.mockReturnValue(query(inventory));
        await expect(service.assertInvariant(product, session)).rejects.toThrow(
            'do not match',
        );
    },
);
it('rejects corrupt batch quantities', async () => {
    batchModel.find.mockReturnValue(query([{ remainingQty: NaN }]));
    await expect(service.assertInvariant(product, session)).rejects.toThrow(
        'Invalid stored batch quantity',
    );
});
it('serializes only explicit batch view keys with date and provenance', async () => {
    batchModel.find.mockReturnValue(
        query([
            {
                _id: batch,
                product: { _id: product, name: 'Milk', EAN: '123', unit: 'KG' },
                restockDetail: detail,
                batchNo: 'A',
                expiryDate: service.today(),
                receivedQty: 10,
                remainingQty: 5,
                reconciliation: false,
                createdAt: new Date(0),
                updatedAt: new Date(1),
                __v: 9,
            },
        ]),
    );
    batchModel.countDocuments.mockResolvedValue(1);
    const result = await service.list({
        page: 2,
        limit: 10,
        product: String(product),
        days: 0,
        expiring: true,
    });
    expect(result.totalItems).toBe(1);
    expect(result.data[0]).toMatchObject({
        _id: String(batch),
        restockDetail: String(detail),
        daysLeft: 0,
        batchNo: 'A',
    });
    expect(result.data[0]).not.toHaveProperty('__v');
});
it('lists reconciliation without invented dates and defaults expiring horizon', async () => {
    batchModel.find.mockReturnValue(
        query([
            {
                _id: batch,
                product: { _id: product, name: 'Milk', EAN: '123' },
                receivedQty: 0,
                remainingQty: -2,
                reconciliation: true,
                createdAt: new Date(0),
                updatedAt: new Date(1),
            },
        ]),
    );
    const result = await service.list({ page: 1, limit: 10 });
    expect(result.data[0]).not.toHaveProperty('expiryDate');
    expect(result.data[0]).not.toHaveProperty('restockDetail');
    await service.list({ page: 1, limit: 1, expiring: true });
    expect(await service.expiringCount()).toBe(0);
});
it('retains tracking once any batch history exists, including empty lots', async () => {
    batchModel.findOne.mockReturnValue(query(null));
    await service.assertCanChangeTracking(product, session);
    batchModel.findOne.mockReturnValue(query({ remainingQty: 0 }));
    await expect(
        service.assertCanChangeTracking(product, session),
    ).rejects.toThrow('batch history exists');
});
it('uses the committed store timezone for expiry consumption and list boundaries', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T16:30:00Z'));
    const timezone = jest.fn().mockResolvedValue('America/Los_Angeles');
    const read = jest.fn().mockResolvedValue({
        timezone: 'America/Los_Angeles',
        expiryAlertDays: 7,
    });
    Reflect.set(service, 'settings', { timezone, read });
    batchModel.find.mockReturnValue(query([]));
    await expect(service.consume(product, 1, session)).rejects.toThrow();
    expect(batchModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ expiryDate: { $gte: '2026-01-01' } }),
    );
    await service.list({ page: 1, limit: 10, expiring: true, days: 0 });
    expect(batchModel.find).toHaveBeenLastCalledWith(
        expect.objectContaining({ expiryDate: { $lte: '2026-01-01' } }),
    );
    expect(timezone).toHaveBeenCalledWith(session);
    jest.useRealTimers();
});

describe('expiry alert window and archived products (#213)', () => {
    afterEach(() => jest.useRealTimers());
    function lastQuery(): Record<string, unknown> {
        return batchModel.find.mock.lastCall![0] as Record<string, unknown>;
    }
    it('defaults the Expiring list and the dashboard count to the store setting', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-01-01T04:00:00Z'));
        Reflect.set(service, 'settings', {
            read: jest
                .fn()
                .mockResolvedValue({ timezone: 'UTC', expiryAlertDays: 30 }),
        });
        batchModel.countDocuments.mockResolvedValue(4);
        await service.list({ page: 1, limit: 10, expiring: true });
        expect(lastQuery()).toMatchObject({
            expiryDate: { $lte: '2026-01-31' },
        });
        expect(await service.expiringCount()).toBe(4);
        expect(lastQuery()).toMatchObject({
            expiryDate: { $lte: '2026-01-31' },
        });
        expect(batchModel.countDocuments).toHaveBeenLastCalledWith(lastQuery());
        // An explicit window still wins.
        await service.list({ page: 1, limit: 10, expiring: true, days: 2 });
        expect(lastQuery()).toMatchObject({
            expiryDate: { $lte: '2026-01-03' },
        });
    });
    it('uses a passed settings snapshot without reading settings again', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-01-01T20:00:00Z'));
        const read = jest.fn();
        Reflect.set(service, 'settings', { read });
        await service.expiringCount({
            timezone: 'Asia/Manila',
            expiryAlertDays: 3,
        });
        expect(read).not.toHaveBeenCalled();
        // 04:00 on 2 Jan in Manila, plus 3 days.
        expect(lastQuery()).toMatchObject({
            expiryDate: { $lte: '2026-01-05' },
        });
    });
    it('falls back to 7 days without the settings service', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-01-01T04:00:00Z'));
        await service.expiringCount();
        expect(lastQuery()).toMatchObject({
            expiryDate: { $lte: '2026-01-08' },
        });
    });
    it('leaves lots of archived products out of the expiring list and count', async () => {
        const archived = new Types.ObjectId();
        productModel.distinct.mockResolvedValue([archived]);
        await service.expiringCount();
        expect(productModel.distinct).toHaveBeenCalledWith('_id', {
            isActive: false,
        });
        expect(lastQuery()).toMatchObject({ product: { $nin: [archived] } });
        await service.list({
            page: 1,
            limit: 10,
            expiring: true,
            product: String(product),
        });
        expect(lastQuery()).toMatchObject({
            product: { $eq: product, $nin: [archived] },
        });
    });
    it('keeps every remaining batch, archived included, in the all-batches list', async () => {
        productModel.distinct.mockResolvedValue([new Types.ObjectId()]);
        await service.list({ page: 1, limit: 10 });
        expect(productModel.distinct).not.toHaveBeenCalled();
        expect(lastQuery()).toEqual({ remainingQty: { $ne: 0 } });
    });
});
