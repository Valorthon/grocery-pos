import { Types } from 'mongoose';
import { migrateUppercaseProductNames } from './uppercase-product-names';

function fixture(rows: Array<{ _id: Types.ObjectId; name: string }>) {
    const products = {
        find: jest.fn().mockReturnValue({ toArray: async () => rows }),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const session = {
        withTransaction: async (fn: () => Promise<void>) => fn(),
        endSession: jest.fn(),
    };
    const connection = {
        db: { collection: jest.fn(() => products) },
        startSession: jest.fn(async () => session),
    };
    return { products, connection };
}

const A = new Types.ObjectId();
const B = new Types.ObjectId();

describe('migrateUppercaseProductNames (#443)', () => {
    it('requires a database', async () => {
        await expect(
            migrateUppercaseProductNames({ db: null } as never, true),
        ).rejects.toThrow('Not connected');
    });

    it('dry run reports the count and writes nothing', async () => {
        const f = fixture([
            { _id: A, name: 'rice' },
            { _id: B, name: 'MILK' },
        ]);
        expect(
            await migrateUppercaseProductNames(f.connection as never, false),
        ).toEqual({ products: 2, toUppercase: 1 });
        expect(f.products.updateOne).not.toHaveBeenCalled();
    });

    it('apply uppercases changed names, filtering on the old name', async () => {
        const f = fixture([{ _id: A, name: 'e2e test rice 1kg' }]);
        await migrateUppercaseProductNames(f.connection as never, true);
        expect(f.products.updateOne).toHaveBeenCalledWith(
            { _id: A, name: 'e2e test rice 1kg' },
            { $set: { name: 'E2E TEST RICE 1KG' } },
            expect.anything(),
        );
    });

    it('is a no-op once migrated', async () => {
        const f = fixture([{ _id: A, name: 'RICE' }]);
        await migrateUppercaseProductNames(f.connection as never, true);
        expect(f.connection.startSession).not.toHaveBeenCalled();
    });

    it('refuses and reports a collision before any write', async () => {
        const f = fixture([
            { _id: A, name: 'rice' },
            { _id: B, name: 'Rice' },
        ]);
        await expect(
            migrateUppercaseProductNames(f.connection as never, true),
        ).rejects.toThrow(`RICE (${A.toString()}, ${B.toString()})`);
        expect(f.products.updateOne).not.toHaveBeenCalled();
    });

    it('refuses a name that grows past the limit', async () => {
        const f = fixture([{ _id: A, name: 'ß'.repeat(30) }]);
        await expect(
            migrateUppercaseProductNames(f.connection as never, true),
        ).rejects.toThrow('exceed');
    });

    it('fails the transaction when a row changed underneath', async () => {
        const f = fixture([{ _id: A, name: 'rice' }]);
        f.products.updateOne.mockResolvedValue({ matchedCount: 0 });
        await expect(
            migrateUppercaseProductNames(f.connection as never, true),
        ).rejects.toThrow('changed during the migration');
    });
});
