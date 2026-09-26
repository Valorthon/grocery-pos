/**
 * Sales against a real MongoDB replica set (issue #30). These are the checks
 * the #53/#54 reviewers ran by hand: unique partial indexes, concurrent
 * idempotent checkout, concurrent reversal, and transaction rollback. Mocked
 * models cannot show any of them: the index, the transaction and the
 * write-conflict retry are the database's.
 */
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { DrawerMovementType, ErrorCode } from '@grocery-pos/contracts';
import { Role } from '../../src/auth/types';
import {
    bootDbApp,
    Caller,
    caller,
    cashSale,
    DbApp,
    gcashSale,
    openShift,
    read,
    seedProduct,
    stockOf,
} from './db-app';

const PRICE = 4_550; // ₱45.50
const MONGO_DUPLICATE_KEY = 11000;

let db: DbApp;
const admin = caller('admin', Role.Admin);
let seller: Caller;

beforeAll(async () => {
    db = await bootDbApp();
    // Model.init() has built the schema's indexes: wait for it, so the
    // index assertions below never race the background build.
    await Promise.all(
        ['Sales', 'SalesDetails', 'Shift', 'Inventory', 'Product'].map((m) =>
            db.model(m).init(),
        ),
    );
    await openShift(db, admin);
});

afterAll(async () => {
    await db?.close();
});

beforeEach(async () => {
    // A fresh cashier (and shift) per test, so tests do not share a drawer.
    seller = caller(`seller-${randomUUID().slice(0, 8)}`, Role.Seller);
    await openShift(db, seller);
});

/** A GCash reference: 13 digits, unique per call. */
let refSeq = 0;
function nextReference(): string {
    refSeq++;
    return (
        `${Date.now() % 1e9}`.padStart(9, '0') + String(refSeq).padStart(4, '0')
    );
}

function salesCollection() {
    return db.connection.db!.collection('sales');
}

/** A minimal legacy sale document, written past the schema. */
function legacySale(extra: Record<string, unknown>) {
    return {
        amount: 100,
        cashier: new Types.ObjectId(),
        paymentType: 'CASH',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...extra,
    };
}

describe('Sales unique partial indexes', () => {
    it('declares referenceNumber and idempotencyKey unique only where they are strings', async () => {
        // The partial filter is what lets legacy and CASH sales (no value)
        // coexist; a plain unique index would refuse the second of them.
        const indexes = await salesCollection().indexes();
        const byKey = (field: string) =>
            indexes.find((i) => Object.keys(i.key).join() === field);

        for (const field of ['referenceNumber', 'idempotencyKey']) {
            expect(byKey(field)).toMatchObject({
                unique: true,
                partialFilterExpression: { [field]: { $type: 'string' } },
            });
        }
    });

    it('lets any number of sales without a reference or key coexist: missing and null never collide', async () => {
        // Legacy sales (from before references and idempotency) have the
        // fields missing or null. None of them may clash with another.
        const result = await salesCollection().insertMany([
            legacySale({}),
            legacySale({}),
            legacySale({ referenceNumber: null, idempotencyKey: null }),
            legacySale({ referenceNumber: null, idempotencyKey: null }),
        ]);
        expect(result.insertedCount).toBe(4);
    });

    it('refuses a second document with the same reference number or key at the index', async () => {
        // Past the service: the index itself is the last line of defence
        // against a double-recorded GCash transfer or a double checkout.
        const reference = nextReference();
        await salesCollection().insertOne(
            legacySale({ referenceNumber: reference }),
        );
        await expect(
            salesCollection().insertOne(
                legacySale({ referenceNumber: reference }),
            ),
        ).rejects.toMatchObject({
            code: MONGO_DUPLICATE_KEY,
            keyPattern: { referenceNumber: 1 },
        });

        const key = randomUUID();
        await salesCollection().insertOne(legacySale({ idempotencyKey: key }));
        await expect(
            salesCollection().insertOne(legacySale({ idempotencyKey: key })),
        ).rejects.toMatchObject({
            code: MONGO_DUPLICATE_KEY,
            keyPattern: { idempotencyKey: 1 },
        });
    });

    it('POST /sales with a used GCash reference is a 409 SALE_001 and changes nothing', async () => {
        const product = await seedProduct(db, PRICE, 10);
        const reference = nextReference();

        const first = await read(
            await db.call(
                seller,
                'POST',
                '/sales',
                gcashSale(product, 1, PRICE, reference),
            ),
        );
        expect(first.status).toBe(201);

        // Another checkout (new key) quoting the same transfer.
        const second = await read(
            await db.call(
                seller,
                'POST',
                '/sales',
                gcashSale(product, 2, 2 * PRICE, reference),
            ),
        );
        expect(second.status).toBe(409);
        expect(second.body.error).toBe(ErrorCode.SALE_DUPLICATE_REFERENCE);

        // The refused sale rolled back: its stock decrement and sale lines
        // are gone with it.
        expect(await stockOf(db, product)).toBe(9);
        expect(
            await db
                .model('Sales')
                .countDocuments({ referenceNumber: reference }),
        ).toBe(1);
        expect(
            await db
                .model('SalesDetails')
                .countDocuments({ product: new Types.ObjectId(product) }),
        ).toBe(1);
    });

    it('two cash sales (no reference) do not collide on the reference index', async () => {
        const product = await seedProduct(db, PRICE, 10);
        for (let i = 0; i < 2; i++) {
            const res = await db.call(
                seller,
                'POST',
                '/sales',
                cashSale(product, 1, PRICE),
            );
            expect(res.status).toBe(201);
        }
        expect(await stockOf(db, product)).toBe(8);
    });
});

describe('POST /sales idempotency under concurrency', () => {
    it('the same key sent 10 times at once records exactly one sale and one stock decrement', async () => {
        const product = await seedProduct(db, PRICE, 50);
        const body = cashSale(product, 3, 3 * PRICE);

        const results = await Promise.all(
            Array.from({ length: 10 }, () =>
                db.call(seller, 'POST', '/sales', body).then(read),
            ),
        );

        // Each attempt either returns the one sale's receipt or asks the
        // client to retry the same key (SALE_004). Never a 5xx, never a
        // second sale.
        const ok = results.filter((r) => r.status === 201);
        const retry = results.filter((r) => r.status === 409);
        expect(ok.length + retry.length).toBe(results.length);
        expect(ok.length).toBeGreaterThan(0);
        for (const r of retry) {
            expect(r.body.error).toBe(ErrorCode.SALE_IN_PROGRESS);
        }
        expect(new Set(ok.map((r) => r.body._id)).size).toBe(1);

        expect(
            await db
                .model('Sales')
                .countDocuments({ idempotencyKey: body.idempotencyKey }),
        ).toBe(1);
        expect(await stockOf(db, product)).toBe(47);
        // One sale charged to the shift, not one per attempt.
        const shift = await db
            .model<{ saleCount: number }>('Shift')
            .findOne({ cashier: new Types.ObjectId(seller.userId) })
            .lean();
        expect(shift?.saleCount).toBe(1);

        // A retry afterwards replays the stored receipt.
        //
        // Which path each loser above took (the committed-sale replay after
        // its own attempt failed, or 409 SALE_004 while the winner was not
        // visible yet) depends on timing, so the burst accepts both and
        // asserting either would flake. The committed-replay branch is
        // pinned by sales.service.spec.ts; this suite pins the invariant:
        // one sale, one decrement, the same receipt for everyone.
        const replay = await read(
            await db.call(seller, 'POST', '/sales', body),
        );
        expect(replay.status).toBe(201);
        expect(replay.body._id).toBe(ok[0].body._id);
        expect(await stockOf(db, product)).toBe(47);
    });

    it('a reused key with a different payment is a 409 SALE_003 carrying the stored receipt', async () => {
        const product = await seedProduct(db, PRICE, 10);
        const body = cashSale(product, 1, PRICE);
        const first = await read(await db.call(seller, 'POST', '/sales', body));
        expect(first.status).toBe(201);

        const changed = await read<{
            error: string;
            details: { receipt: { _id: string } };
        }>(
            await db.call(seller, 'POST', '/sales', {
                ...body,
                tenders: [{ type: 'CASH', amount: 10_000 }],
            }),
        );
        expect(changed.status).toBe(409);
        expect(changed.body.error).toBe(ErrorCode.SALE_IDEMPOTENCY_MISMATCH);
        expect(changed.body.details.receipt._id).toBe(first.body._id);
        expect(await stockOf(db, product)).toBe(9);
    });
});

describe('void/refund under concurrency', () => {
    it('10 concurrent voids and refunds of one sale reverse it exactly once', async () => {
        const product = await seedProduct(db, PRICE, 20);
        const sale = await read(
            await db.call(
                seller,
                'POST',
                '/sales',
                cashSale(product, 4, 4 * PRICE),
            ),
        );
        expect(sale.status).toBe(201);
        expect(await stockOf(db, product)).toBe(16);
        const saleId = sale.body._id as string;

        const results = await Promise.all(
            Array.from({ length: 10 }, (_, i) =>
                db
                    .call(
                        admin,
                        'POST',
                        `/sales/${saleId}/${i % 2 ? 'refund' : 'void'}`,
                        { reason: `attempt ${i}` },
                    )
                    .then(read),
            ),
        );

        // One claim wins; every other attempt sees a reversed sale.
        const ok = results.filter((r) => r.status === 201);
        const refused = results.filter((r) => r.status === 409);
        expect(ok).toHaveLength(1);
        expect(refused).toHaveLength(9);
        for (const r of refused) {
            expect(r.body.error).toBe(ErrorCode.SALE_NOT_REVERSIBLE);
        }

        // The stock comes back once, and one payout leaves the drawer.
        expect(await stockOf(db, product)).toBe(20);
        const shift = await db
            .model<{
                movements: { type: DrawerMovementType; amount: number }[];
            }>('Shift')
            .findOne({ cashier: new Types.ObjectId(seller.userId) })
            .lean();
        const payouts = shift!.movements.filter(
            (m) => m.type === DrawerMovementType.REVERSAL_PAYOUT,
        );
        expect(payouts).toEqual([
            expect.objectContaining({ amount: 4 * PRICE }),
        ]);
    });

    it('rolls the whole reversal back when returning the stock fails after writing part of it', async () => {
        const first = await seedProduct(db, PRICE, 10);
        const broken = await seedProduct(db, PRICE, 10);
        const sale = await read(
            await db.call(seller, 'POST', '/sales', {
                ...cashSale(first, 1, 3 * PRICE),
                sellDetails: [
                    { product: first, quantity: 1 },
                    { product: broken, quantity: 2 },
                ],
            }),
        );
        expect(sale.status).toBe(201);
        const saleId = sale.body._id as string;
        expect(await stockOf(db, first)).toBe(9);

        // The stock return is the last step of the reversal, after the
        // sale was marked voided and the payout pushed onto the shift.
        // Its ordered bulkWrite gives `first` its unit back, then fails on
        // `broken`, whose stock (written past the schema) is not a number:
        // `$inc` refuses it. So by the time it throws, the transaction has
        // written to the sale, the shift and `first`'s stock.
        await db.connection
            .db!.collection('inventories')
            .updateOne(
                { product: new Types.ObjectId(broken) },
                { $set: { stock: 'corrupt' } },
            );

        const res = await read(
            await db.call(admin, 'POST', `/sales/${saleId}/void`, {
                reason: 'mis-ring',
            }),
        );
        // An unexpected driver error: a generic 500, nothing leaked.
        expect(res.status).toBe(500);
        expect(res.body.error).toBe(ErrorCode.INTERNAL_ERROR);

        // All of it was rolled back: still a completed sale with no
        // reversal, no payout on the drawer, and `first`'s returned unit
        // is gone again.
        const stored = await db
            .model<{ status: string; reversal?: unknown }>('Sales')
            .findById(saleId)
            .lean();
        expect(stored?.status).toBe('COMPLETED');
        expect(stored?.reversal).toBeUndefined();
        expect(await stockOf(db, first)).toBe(9);
        const shift = await db
            .model<{ movements: { type: DrawerMovementType }[] }>('Shift')
            .findOne({ cashier: new Types.ObjectId(seller.userId) })
            .lean();
        expect(
            shift!.movements.filter(
                (m) => m.type === DrawerMovementType.REVERSAL_PAYOUT,
            ),
        ).toEqual([]);
    });
});
