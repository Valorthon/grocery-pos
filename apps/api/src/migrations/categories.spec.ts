import { Types } from 'mongoose';
import { migrateCategories } from './categories';
function fixture(
    legacy: Array<{ _id: Types.ObjectId; category: string }> = [],
) {
    const products = {
        find: jest.fn().mockReturnValue({ toArray: async () => legacy }),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const model = {
        init: jest.fn().mockResolvedValue(undefined),
        findOneAndUpdate: jest
            .fn()
            .mockResolvedValue({ _id: new Types.ObjectId() }),
    };
    const session = {
        withTransaction: async (fn: () => Promise<void>) => fn(),
        endSession: jest.fn(),
    };
    const connection = {
        db: { collection: jest.fn(() => products) },
        model: jest.fn(() => model),
        startSession: async () => session,
    };
    return { products, model, session, connection };
}
it('requires a database and refuses unknown legacy values without writing', async () => {
    await expect(
        migrateCategories({ db: null } as never, true),
    ).rejects.toThrow('Not connected');
    const f = fixture([{ _id: new Types.ObjectId(), category: 'UNKNOWN' }]);
    await expect(
        migrateCategories(f.connection as never, true),
    ).rejects.toThrow('Unknown category strings');
    expect(f.products.updateMany).not.toHaveBeenCalled();
});
it('dry run counts each known value without creating or rewriting records', async () => {
    const f = fixture([{ _id: new Types.ObjectId(), category: 'FOOD' }]);
    expect(await migrateCategories(f.connection as never, false)).toEqual([
        { name: 'FOOD', products: 1 },
        { name: 'DRINKS', products: 0 },
        { name: 'ELECTRONICS', products: 0 },
        { name: 'HOUSEHOLD', products: 0 },
        { name: 'CLOTHES', products: 0 },
    ]);
    expect(f.connection.model).not.toHaveBeenCalled();
    expect(f.model.init).not.toHaveBeenCalled();
    expect(f.products.updateMany).not.toHaveBeenCalled();
});
it('upserts stable name keys and rewrites only matching legacy values inside one transaction', async () => {
    const f = fixture([{ _id: new Types.ObjectId(), category: 'FOOD' }]);
    await migrateCategories(f.connection as never, true);
    expect(f.model.init).toHaveBeenCalled();
    expect(f.model.findOneAndUpdate).toHaveBeenCalledTimes(5);
    expect(f.model.findOneAndUpdate).toHaveBeenCalledWith(
        { nameKey: 'food' },
        { $setOnInsert: { name: 'FOOD', isActive: true, sortOrder: 0 } },
        { upsert: true, new: true, session: f.session },
    );
    expect(f.products.updateMany).toHaveBeenCalledWith(
        { category: 'FOOD' },
        { $set: { category: expect.any(Types.ObjectId) } },
        { session: f.session },
    );
    expect(f.session.endSession).toHaveBeenCalled();
});
it('always ends a failed migration session so the transaction can roll back', async () => {
    const f = fixture();
    f.products.updateMany.mockRejectedValue(new Error('write failure'));
    await expect(
        migrateCategories(f.connection as never, true),
    ).rejects.toThrow('write failure');
    expect(f.session.endSession).toHaveBeenCalled();
});
