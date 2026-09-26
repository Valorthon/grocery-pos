/**
 * Concurrent first sales on a cold, empty database (issue #30).
 *
 * A reviewer once saw 14 of 40 concurrent sales on a fresh database answer
 * 500 "Transaction failed". The sales and sale-line collections did not
 * exist yet, so the first transactions raced to create them (and the
 * indexes Mongoose builds in the background) inside the transaction.
 *
 * Here the products, inventory and open shifts are seeded straight through
 * the driver before the app boots, so the collections a sale writes first
 * (sales, salesdetails) are still missing when the requests arrive, right
 * after `listen`.
 */
import { Types } from 'mongoose';
import { DEFAULT_TERMINAL, ShiftStatus } from '@grocery-pos/contracts';
import { Role } from '../../src/auth/types';
import {
    bootDbApp,
    caller,
    cashSale,
    DbApp,
    FLOAT_COUNTS,
    productDocs,
    read,
    stockOf,
    withRawDb,
} from './db-app';

const CASHIERS = 40;
const PRICE = 2_500;
const STOCK = 1_000;

describe('cold database: concurrent first sales (e2e, real MongoDB)', () => {
    let db: DbApp | null = null;

    afterEach(async () => {
        await db?.close();
        db = null;
    });

    it(`${CASHIERS} cashiers' first sales at once all succeed, each decrementing stock once`, async () => {
        const cashiers = Array.from({ length: CASHIERS }, (_, i) =>
            caller(`lane${i}`, Role.Seller),
        );
        const { product, inventory } = productDocs(PRICE, STOCK);

        await withRawDb(async (raw) => {
            await raw.collection('products').insertOne(product);
            await raw.collection('inventories').insertOne(inventory);
            await raw.collection('shifts').insertMany(
                cashiers.map((c) => ({
                    cashier: new Types.ObjectId(c.userId),
                    cashierName: c.username,
                    terminal: DEFAULT_TERMINAL,
                    status: ShiftStatus.OPEN,
                    openedAt: new Date(),
                    openingFloat: 100_000,
                    openingCounts: FLOAT_COUNTS,
                    movements: [],
                    saleCount: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })),
            );
            // The point of the test: nothing a sale creates exists yet.
            const names = (await raw.listCollections().toArray()).map(
                (c) => c.name,
            );
            expect(names).not.toContain('sales');
            expect(names).not.toContain('salesdetails');
        });

        db = await bootDbApp();
        const productId = product._id.toString();

        const results = await Promise.all(
            cashiers.map((c) =>
                db!
                    .call(c, 'POST', '/sales', cashSale(productId, 1, PRICE))
                    .then((res) => read(res)),
            ),
        );

        // Every sale is recorded: none is lost to a 500 while the
        // collections and indexes come into being.
        const failures = results.filter((r) => r.status !== 201);
        expect(failures).toEqual([]);
        expect(await db.model('Sales').countDocuments()).toBe(CASHIERS);
        expect(await db.model('SalesDetails').countDocuments()).toBe(CASHIERS);
        expect(await stockOf(db, productId)).toBe(STOCK - CASHIERS);
    });
});
