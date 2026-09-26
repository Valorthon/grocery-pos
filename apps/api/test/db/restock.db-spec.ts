/**
 * A restock at a ₱0 unit cost (#85), on the real schemas: the DTO, the
 * RestockDetails `unitCost` and the Restock `totalCost` all take 0, and a
 * negative cost is still refused before anything is written.
 */
import { Types } from 'mongoose';
import { Role } from '../../src/auth/types';
import { bootDbApp, caller, DbApp, read, seedProduct, stockOf } from './db-app';

describe('restock at a ₱0 unit cost (e2e, real MongoDB)', () => {
    let db: DbApp;
    const restocker = caller('rita', Role.Restocker);

    beforeAll(async () => {
        db = await bootDbApp();
    });

    afterAll(async () => {
        await db.close();
    });

    async function lastRestock() {
        const [restock] = await db
            .model<{ _id: Types.ObjectId; totalCost: number }>('Restock')
            .find()
            .sort({ _id: -1 })
            .limit(1)
            .lean();
        const lines = await db
            .model<{ product: Types.ObjectId; unitCost: number }>(
                'RestockDetails',
            )
            .find({ restock: restock._id })
            .sort({ _id: 1 })
            .lean();
        return { restock, lines };
    }

    it('records a ₱0 line beside a paid one: stock up, total from the paid line only', async () => {
        const paid = await seedProduct(db, 2_000, 5);
        const free = await seedProduct(db, 1_500, 0);

        const res = await read(
            await db.call(restocker, 'POST', '/restocks', {
                description: 'Delivery with samples',
                restockDetails: [
                    { product: paid, quantity: 3, unitCost: 1_250 },
                    { product: free, quantity: 4, unitCost: 0 },
                ],
            }),
        );

        expect(res.status).toBe(201);
        expect(await stockOf(db, paid)).toBe(8);
        expect(await stockOf(db, free)).toBe(4);
        const { restock, lines } = await lastRestock();
        expect(restock.totalCost).toBe(3_750);
        expect(lines.map((l) => [l.product.toString(), l.unitCost])).toEqual([
            [paid, 1_250],
            [free, 0],
        ]);
    });

    it('records a restock of free lines only at a ₱0 total', async () => {
        const free = await seedProduct(db, 1_500, 0);

        const res = await read(
            await db.call(restocker, 'POST', '/restocks', {
                description: 'Free samples',
                restockDetails: [{ product: free, quantity: 6, unitCost: 0 }],
            }),
        );

        expect(res.status).toBe(201);
        expect(await stockOf(db, free)).toBe(6);
        const { restock, lines } = await lastRestock();
        expect(restock.totalCost).toBe(0);
        expect(lines.map((l) => l.unitCost)).toEqual([0]);
    });

    it('still refuses a negative unit cost and writes nothing', async () => {
        const product = await seedProduct(db, 1_500, 2);
        const before = await db.model('Restock').countDocuments();

        const res = await read(
            await db.call(restocker, 'POST', '/restocks', {
                description: 'Bad',
                restockDetails: [{ product, quantity: 1, unitCost: -1 }],
            }),
        );

        expect(res.status).toBe(400);
        expect(await stockOf(db, product)).toBe(2);
        expect(await db.model('Restock').countDocuments()).toBe(before);
    });
});
