import { Types, type Model, type ClientSession } from 'mongoose';
import { InventoryService } from './inventory.service';
import { Inventory } from './inventory.schema';
import { InventoryBatchService } from '../batch/batch.service';
import { ProductService } from '../../product/product.service';
import type { SellDto } from '../../sales/types';
const product = new Types.ObjectId(),
    user = new Types.ObjectId().toString(),
    batch = new Types.ObjectId().toString(),
    session = {} as ClientSession;
function query(value: unknown) {
    return {
        populate: jest.fn().mockReturnThis(),
        session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(value),
    };
}
function fixture(tracked = true) {
    const inventory = {
        findOne: jest.fn(() => query({ stock: 0 })),
        find: jest.fn(() =>
            query([{ product: { _id: product, name: 'Milk' }, stock: 4 }]),
        ),
        bulkWrite: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const products = {
        getMany: jest
            .fn()
            .mockResolvedValue(
                new Map([[String(product), { tracksExpiry: tracked }]]),
            ),
    };
    const batches = {
        assertCanChangeTracking: jest.fn().mockResolvedValue(undefined),
        adjust: jest.fn().mockResolvedValue(undefined),
        restore: jest.fn().mockResolvedValue(undefined),
        consume: jest.fn().mockResolvedValue([{ batch, quantity: 1 }]),
        assertInvariant: jest.fn().mockResolvedValue(undefined),
    };
    const service = new InventoryService(
        inventory as unknown as Model<Inventory>,
        products as unknown as ProductService,
        batches as unknown as InventoryBatchService,
    );
    return { service, inventory, products, batches };
}
it('checks zero stock and batch reconciliation before enabling/disabling tracking', async () => {
    const f = fixture();
    await f.service.assertTrackingChange(String(product), session);
    expect(f.batches.assertCanChangeTracking).toHaveBeenCalledWith(
        product,
        session,
    );
    f.inventory.findOne.mockReturnValue(query(null));
    await f.service.assertTrackingChange(String(product), session);
    f.inventory.findOne.mockReturnValue(query({ stock: -1 }));
    await expect(
        f.service.assertTrackingChange(String(product), session),
    ).rejects.toThrow('only when stock is zero');
});
it('locks product tracking while adjusting, then applies lot changes atomically', async () => {
    const f = fixture();
    const line = {
        product: String(product),
        batch,
        change: -1,
        reason: 'Write off',
    };
    await f.service.adjust(
        user,
        { description: 'Expired', adjustDetails: [line] },
        session,
    );
    expect(f.products.getMany).toHaveBeenCalledWith([String(product)], session);
    expect(f.batches.adjust).toHaveBeenCalledWith([line], session);
});
it.each([true, false])(
    'returns stock to stored allocations and validates tracked=%s',
    async (tracked) => {
        const f = fixture(tracked);
        const allocations = [{ batch, quantity: 1 }];
        await f.service.returnStock(
            user,
            [{ product, quantity: 1, batchAllocations: allocations }],
            session,
        );
        expect(f.batches.restore).toHaveBeenCalledWith(
            product,
            1,
            allocations,
            session,
        );
        expect(f.batches.assertInvariant).toHaveBeenCalledTimes(
            tracked ? 1 : 0,
        );
    },
);
it.each([true, false])(
    'consumes online batches and verifies tracked=%s after aggregate write',
    async (tracked) => {
        const f = fixture(tracked);
        const allocations = await f.service.sell(
            user,
            {
                sellDetails: [{ product: String(product), quantity: 1 }],
            } as SellDto,
            session,
        );
        expect(allocations).toEqual([[{ batch, quantity: 1 }]]);
        expect(f.batches.consume).toHaveBeenCalledWith(product, 1, session);
        expect(f.batches.assertInvariant).toHaveBeenCalledTimes(
            tracked ? 1 : 0,
        );
    },
);
