/**
 * The at-most-one OPEN shift per cashier rule (issue #2) against a real
 * MongoDB (issue #30). `ShiftService.open` checks for an open shift first,
 * but two concurrent opens both pass that check: only the unique partial
 * index `one_open_shift_per_cashier` stops the second, and only a real
 * database enforces it.
 */
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
    DEFAULT_TERMINAL,
    ErrorCode,
    ShiftStatus,
} from '@grocery-pos/contracts';
import { Role } from '../../src/auth/types';
import {
    bootDbApp,
    caller,
    DbApp,
    FLOAT_COUNTS,
    openShift,
    read,
} from './db-app';

const MONGO_DUPLICATE_KEY = 11000;

let db: DbApp;

beforeAll(async () => {
    db = await bootDbApp();
    await db.model('Shift').init();
});

afterAll(async () => {
    await db?.close();
});

function newSeller() {
    return caller(`seller-${randomUUID().slice(0, 8)}`, Role.Seller);
}

function shiftDoc(cashier: string, status: ShiftStatus) {
    return {
        cashier: new Types.ObjectId(cashier),
        cashierName: 'x',
        terminal: DEFAULT_TERMINAL,
        status,
        openedAt: new Date(),
        openingFloat: 100_000,
        openingCounts: FLOAT_COUNTS,
        movements: [],
        saleCount: 0,
    };
}

function openCount(cashier: string) {
    return db.model('Shift').countDocuments({
        cashier: new Types.ObjectId(cashier),
        status: ShiftStatus.OPEN,
    });
}

describe('one open shift per cashier (e2e, real MongoDB)', () => {
    it('is a unique index on cashier, partial on status OPEN', async () => {
        const indexes = await db.connection.db!.collection('shifts').indexes();
        expect(
            indexes.find((i) => i.name === 'one_open_shift_per_cashier'),
        ).toMatchObject({
            key: { cashier: 1 },
            unique: true,
            partialFilterExpression: { status: ShiftStatus.OPEN },
        });
    });

    it('10 concurrent opens by one cashier open exactly one shift; the rest are 409 SHIFT_ALREADY_OPEN', async () => {
        const seller = newSeller();
        const results = await Promise.all(
            Array.from({ length: 10 }, () =>
                db
                    .call(seller, 'POST', '/shifts', { counts: FLOAT_COUNTS })
                    .then(read),
            ),
        );

        // Never a 500: a clash at the index is turned into the same 409
        // the pre-check gives.
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
        const refused = results.filter((r) => r.status !== 201);
        expect(refused).toHaveLength(9);
        for (const r of refused) {
            expect(r.status).toBe(409);
            expect(r.body.error).toBe(ErrorCode.SHIFT_ALREADY_OPEN);
        }
        expect(await openCount(seller.userId)).toBe(1);
    });

    it('closed shifts do not count: a cashier closes and opens again, as often as needed', async () => {
        const seller = newSeller();
        for (let i = 0; i < 3; i++) {
            await openShift(db, seller);
            const closed = await db.call(
                seller,
                'POST',
                '/shifts/current/close',
                { counts: FLOAT_COUNTS },
            );
            expect(closed.status).toBe(201);
        }
        await openShift(db, seller);

        expect(await openCount(seller.userId)).toBe(1);
        expect(
            await db.model('Shift').countDocuments({
                cashier: new Types.ObjectId(seller.userId),
                status: ShiftStatus.CLOSED,
            }),
        ).toBe(3);
    });

    it('two cashiers each hold their own open shift', async () => {
        const a = newSeller();
        const b = newSeller();
        await Promise.all([openShift(db, a), openShift(db, b)]);
        expect(await openCount(a.userId)).toBe(1);
        expect(await openCount(b.userId)).toBe(1);
    });

    it('the index itself refuses a second OPEN shift written past the service', async () => {
        const seller = newSeller();
        const shifts = db.connection.db!.collection('shifts');
        await shifts.insertOne(shiftDoc(seller.userId, ShiftStatus.OPEN));
        await expect(
            shifts.insertOne(shiftDoc(seller.userId, ShiftStatus.OPEN)),
        ).rejects.toMatchObject({
            code: MONGO_DUPLICATE_KEY,
            keyPattern: { cashier: 1 },
        });
        // ...while CLOSED ones pile up freely beside it.
        await shifts.insertMany([
            shiftDoc(seller.userId, ShiftStatus.CLOSED),
            shiftDoc(seller.userId, ShiftStatus.CLOSED),
        ]);
    });
});
