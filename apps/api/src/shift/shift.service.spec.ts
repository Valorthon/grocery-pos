import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import {
    DEFAULT_TERMINAL,
    DrawerMovementType,
    ErrorCode,
    NUMERIC_LIMITS,
    PaymentType,
    ReversalType,
    Role,
    SaleStatus,
    ShiftStatus,
    TenderType,
    wireShapeDiff,
    Z_READ_DRAWER_SHAPE,
    Z_READ_REPORT_SHAPE,
    Z_READ_SALES_SHAPE,
    Z_READ_TENDERS_SHAPE,
} from '@grocery-pos/contracts';
import { AuthUser } from '../auth/types';
import { runInTransaction } from '../common/utils/db';
import { Sales } from '../sales/sales.schema';
import { Shift } from './shift.schema';
import { ShiftService } from './shift.service';
import {
    FakeModel,
    fakeConnection,
    fakeShiftModel,
} from './testing/fake-shift-model';

const ANA: AuthUser = {
    userId: new Types.ObjectId().toString(),
    username: 'ana',
    roles: [Role.Seller],
};
const BEN: AuthUser = {
    userId: new Types.ObjectId().toString(),
    username: 'ben',
    roles: [Role.Seller],
};
const BOSS: AuthUser = {
    userId: new Types.ObjectId().toString(),
    username: 'boss',
    roles: [Role.Admin],
};

/** ₱1,000 float: one ₱500 bill, two ₱200 bills, one ₱100 bill. */
const FLOAT_COUNTS = { '500': 1, '200': 2, '100': 1 };
const FLOAT = 100_000;

let service: ShiftService;
let shifts: FakeModel;
let sales: FakeModel;
let connection: ReturnType<typeof fakeConnection>;

beforeEach(async () => {
    shifts = fakeShiftModel();
    sales = new FakeModel();
    connection = fakeConnection(shifts, sales);

    const moduleRef = await Test.createTestingModule({
        providers: [
            ShiftService,
            { provide: getConnectionToken(), useValue: connection },
            { provide: getModelToken(Shift.name), useValue: shifts },
            { provide: getModelToken(Sales.name), useValue: sales },
        ],
    }).compile();

    service = moduleRef.get(ShiftService);
});

/** Runs `fn` in a fake transaction, as SalesService does. */
function inTransaction<T>(fn: (session: ClientSession) => Promise<T>) {
    return runInTransaction(fn, connection as unknown as Connection);
}

/** Rings a sale into `user`'s open shift the way SalesService does. */
async function ring(user: AuthUser, sale: Record<string, unknown>) {
    return inTransaction(async (session) => {
        const shift = await service.chargeSale(user.userId, session);
        return sales.seed({
            cashier: new Types.ObjectId(user.userId),
            status: SaleStatus.COMPLETED,
            ...sale,
            shift,
        });
    });
}

function cashSale(amount: number, tendered = amount) {
    return {
        amount,
        paymentType: PaymentType.CASH,
        tenders: [{ type: TenderType.CASH, amount: tendered }],
        changeGiven: tendered - amount,
    };
}

/** Counts adding up to `centavos` in ₱1 coins plus a ₱0.25 remainder. */
function countsOf(centavos: number) {
    return {
        'coin-1': Math.floor(centavos / 100),
        'coin-25c': (centavos % 100) / 25,
    };
}

describe('ShiftService.open', () => {
    it('opens a shift with the float the server adds up from the count', async () => {
        const view = await service.open(ANA, FLOAT_COUNTS);

        expect(view).toMatchObject({
            status: ShiftStatus.OPEN,
            cashierName: 'ana',
            terminal: DEFAULT_TERMINAL,
            openingFloat: FLOAT,
            movements: [],
        });
        const [row] = shifts.rows;
        expect(String(row.cashier)).toBe(ANA.userId);
        expect(row.openingCounts).toEqual(FLOAT_COUNTS);
    });

    it.each([
        ['an empty count', {}],
        ['only zero counts', { '500': 0 }],
    ])('refuses %s: a shift opens with cash', async (_, counts) => {
        await expect(service.open(ANA, counts)).rejects.toMatchObject({
            statusCode: 400,
            code: ErrorCode.VALIDATION_INVALID_INPUT,
        });
        expect(shifts.rows).toHaveLength(0);
    });

    it('refuses a count above the money limit', async () => {
        const pieces = NUMERIC_LIMITS.AMOUNT_MAX / 100_000 + 1;

        await expect(
            service.open(ANA, { '1000': pieces }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('refuses a second open shift for the same cashier with 409', async () => {
        await service.open(ANA, FLOAT_COUNTS);

        await expect(service.open(ANA, FLOAT_COUNTS)).rejects.toMatchObject({
            statusCode: 409,
            code: ErrorCode.SHIFT_ALREADY_OPEN,
        });
        expect(shifts.rows).toHaveLength(1);
    });

    it('turns a concurrent open that loses the unique index into the same 409', async () => {
        await service.open(ANA, FLOAT_COUNTS);
        // The pre-check ran before the winner committed.
        jest.spyOn(shifts, 'findOne').mockReturnValueOnce(
            new FakeModel().findOne({}),
        );

        await expect(service.open(ANA, FLOAT_COUNTS)).rejects.toMatchObject({
            statusCode: 409,
            code: ErrorCode.SHIFT_ALREADY_OPEN,
        });
    });

    it('lets different cashiers each open one', async () => {
        await service.open(ANA, FLOAT_COUNTS);
        await service.open(BEN, FLOAT_COUNTS);

        expect(shifts.rows).toHaveLength(2);
    });

    it('lets a cashier open a new shift once the last one closed', async () => {
        await service.open(ANA, FLOAT_COUNTS);
        await service.closeOwn(ANA, FLOAT_COUNTS);

        await expect(service.open(ANA, FLOAT_COUNTS)).resolves.toMatchObject({
            status: ShiftStatus.OPEN,
        });
    });
});

describe('ShiftService.current (blind)', () => {
    it('is null without an open shift', async () => {
        await expect(service.current(ANA)).resolves.toBeNull();
    });

    it('never returns another cashier’s shift', async () => {
        await service.open(BEN, FLOAT_COUNTS);

        await expect(service.current(ANA)).resolves.toBeNull();
    });

    it('shows the cashier their shift, their float and their own movements only', async () => {
        const { _id } = await service.open(ANA, FLOAT_COUNTS);
        await ring(ANA, cashSale(45_000, 50_000));
        await service.recordDrawer(ANA, {
            type: DrawerMovementType.CASH_DROP,
            amount: 20_000,
            reason: 'to safe',
        });
        await inTransaction((session) =>
            service.payOutReversal(
                {
                    saleId: String(new Types.ObjectId()),
                    saleShift: new Types.ObjectId(_id),
                    amount: 5_000,
                    type: ReversalType.REFUND,
                    reason: 'return',
                    admin: BOSS,
                },
                session,
            ),
        );

        const view = await service.current(ANA);

        // Exactly these keys: no expected cash, sales totals or variance.
        expect(Object.keys(view!).sort()).toEqual(
            [
                '_id',
                'cashierName',
                'movements',
                'openedAt',
                'openingFloat',
                'status',
                'terminal',
            ].sort(),
        );
        expect(view!.movements).toEqual([
            expect.objectContaining({
                type: DrawerMovementType.CASH_DROP,
                amount: 20_000,
                byName: 'ana',
            }),
        ]);
        expect(JSON.stringify(view)).not.toMatch(/expected|overShort|gross/i);
    });
});

describe('ShiftService.recordDrawer', () => {
    it('records a cash in on the caller’s open shift', async () => {
        await service.open(ANA, FLOAT_COUNTS);

        const view = await service.recordDrawer(ANA, {
            type: DrawerMovementType.CASH_IN,
            amount: 10_000,
            reason: 'coins',
        });

        expect(view.movements).toEqual([
            expect.objectContaining({
                type: DrawerMovementType.CASH_IN,
                amount: 10_000,
                reason: 'coins',
            }),
        ]);
    });

    it('records a cash drop larger than the drawer could hold: it is not checked', async () => {
        await service.open(ANA, FLOAT_COUNTS);

        await expect(
            service.recordDrawer(ANA, {
                type: DrawerMovementType.CASH_DROP,
                amount: FLOAT * 10,
                reason: 'safe',
            }),
        ).resolves.toBeDefined();
    });

    it('refuses without an open shift', async () => {
        await expect(
            service.recordDrawer(ANA, {
                type: DrawerMovementType.CASH_IN,
                amount: 100,
                reason: 'x',
            }),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: ErrorCode.SHIFT_NOT_OPEN,
        });
    });
});

describe('ShiftService.chargeSale', () => {
    it('bumps the open shift and returns its id', async () => {
        const { _id } = await service.open(ANA, FLOAT_COUNTS);

        const id = await inTransaction((s) =>
            service.chargeSale(ANA.userId, s),
        );

        expect(String(id)).toBe(_id);
        expect(shifts.byId(_id)!.saleCount).toBe(1);
    });

    it('filters on the cashier and status OPEN', async () => {
        await service.open(ANA, FLOAT_COUNTS);
        const spy = jest.spyOn(shifts, 'findOneAndUpdate');

        await inTransaction((s) => service.chargeSale(ANA.userId, s));

        expect(spy.mock.calls[0][0]).toEqual({
            cashier: new Types.ObjectId(ANA.userId),
            status: ShiftStatus.OPEN,
        });
    });

    it('refuses a sale for a cashier with no open shift', async () => {
        await service.open(BEN, FLOAT_COUNTS);

        await expect(
            inTransaction((s) => service.chargeSale(ANA.userId, s)),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: ErrorCode.SHIFT_NOT_OPEN,
        });
    });

    it('refuses a sale once the shift is closed', async () => {
        await service.open(ANA, FLOAT_COUNTS);
        await service.closeOwn(ANA, FLOAT_COUNTS);

        await expect(
            inTransaction((s) => service.chargeSale(ANA.userId, s)),
        ).rejects.toMatchObject({ code: ErrorCode.SHIFT_NOT_OPEN });
    });
});

describe('ShiftService.closeOwn (Z-read)', () => {
    it('returns exactly the keys of the contracts ZReadReport, section by section (#27)', async () => {
        await service.open(ANA, FLOAT_COUNTS);
        await ring(ANA, cashSale(45_000, 50_000));
        const report = await service.closeOwn(ANA, FLOAT_COUNTS);

        const none = { missing: [], unexpected: [] };
        expect(wireShapeDiff(report, Z_READ_REPORT_SHAPE)).toEqual(none);
        expect(wireShapeDiff(report.sales, Z_READ_SALES_SHAPE)).toEqual(none);
        expect(wireShapeDiff(report.tenders, Z_READ_TENDERS_SHAPE)).toEqual(
            none,
        );
        expect(wireShapeDiff(report.drawer, Z_READ_DRAWER_SHAPE)).toEqual(none);
    });

    it('computes expected cash from float, movements, sales and payouts, and the variance', async () => {
        const { _id } = await service.open(ANA, FLOAT_COUNTS);
        const shiftId = new Types.ObjectId(_id);

        // ₱450 cash sale paid with ₱500: ₱450 stays.
        await ring(ANA, cashSale(45_000, 50_000));
        // ₱800 split: ₱500 cash + ₱500 GCash, ₱200 change: ₱300 stays.
        await ring(ANA, {
            amount: 80_000,
            paymentType: PaymentType.SPLIT,
            tenders: [
                { type: TenderType.CASH, amount: 50_000 },
                { type: TenderType.GCASH, amount: 50_000 },
            ],
            changeGiven: 20_000,
            discount: { amount: 10_000 },
        });
        // ₱300 GCash: no cash.
        await ring(ANA, {
            amount: 30_000,
            paymentType: PaymentType.GCASH,
            tenders: [{ type: TenderType.GCASH, amount: 30_000 }],
            changeGiven: 0,
        });
        // ₱200 cash sale, voided in the same shift: its payout cancels it.
        const voided = await ring(ANA, cashSale(20_000));
        voided.status = SaleStatus.VOIDED;
        await inTransaction((session) =>
            service.payOutReversal(
                {
                    saleId: String(voided._id),
                    saleShift: shiftId,
                    amount: 20_000,
                    type: ReversalType.VOID,
                    reason: 'mis-ring',
                    admin: BOSS,
                },
                session,
            ),
        );
        await service.recordDrawer(ANA, {
            type: DrawerMovementType.CASH_IN,
            amount: 20_000,
            reason: 'coins',
        });
        await service.recordDrawer(ANA, {
            type: DrawerMovementType.CASH_DROP,
            amount: 50_000,
            reason: 'safe',
        });

        // 1,000 + 200 - 500 + (450 + 300 + 0 + 200) - 200 = 1,450; ₱10 short.
        const report = await service.closeOwn(ANA, countsOf(144_000));

        expect(report.drawer).toEqual({
            openingFloat: FLOAT,
            cashIn: 20_000,
            cashDrops: 50_000,
            reversalPayouts: { count: 1, amount: 20_000 },
            expectedCash: 145_000,
            countedCash: 144_000,
            overShort: -1_000,
        });
        expect(report.sales).toEqual({
            count: 4,
            gross: 175_000,
            discounts: { count: 1, amount: 10_000 },
            voids: { count: 1, amount: 20_000 },
            refunds: { count: 0, amount: 0 },
            net: 155_000,
        });
        // Reconciles: every centavo of gross was paid in cash or GCash.
        expect(report.tenders).toEqual({ cash: 95_000, gcash: 80_000 });
        expect(report.tenders.cash + report.tenders.gcash).toBe(
            report.sales.gross,
        );
        expect(report).toMatchObject({
            shiftId: _id,
            cashierName: 'ana',
            terminal: DEFAULT_TERMINAL,
            closedByName: 'ana',
            closedByAdmin: false,
        });
        expect(report.movements.map((m) => m.type)).toEqual([
            DrawerMovementType.REVERSAL_PAYOUT,
            DrawerMovementType.CASH_IN,
            DrawerMovementType.CASH_DROP,
        ]);
    });

    it('reports an exact count as zero variance', async () => {
        await service.open(ANA, FLOAT_COUNTS);
        await ring(ANA, cashSale(12_525));

        const report = await service.closeOwn(ANA, countsOf(FLOAT + 12_525));

        expect(report.drawer.expectedCash).toBe(112_525);
        expect(report.drawer.overShort).toBe(0);
    });

    it('counts only the closing shift’s sales', async () => {
        await service.open(ANA, FLOAT_COUNTS);
        await service.open(BEN, FLOAT_COUNTS);
        await ring(BEN, cashSale(99_900));

        const report = await service.closeOwn(ANA, FLOAT_COUNTS);

        expect(report.sales.count).toBe(0);
        expect(report.drawer.expectedCash).toBe(FLOAT);
    });

    it('persists the Z-read on the shift and closes it', async () => {
        const { _id } = await service.open(ANA, FLOAT_COUNTS);
        await ring(ANA, cashSale(5_000));

        const report = await service.closeOwn(ANA, FLOAT_COUNTS);

        const row = shifts.byId(_id)!;
        expect(row.status).toBe(ShiftStatus.CLOSED);
        expect(String(row.closedBy)).toBe(ANA.userId);
        expect(row.closingCounts).toEqual(FLOAT_COUNTS);
        expect(row.closedAt).toBeInstanceOf(Date);
        expect(row.zRead).toMatchObject({
            shiftId: _id,
            drawer: { expectedCash: 105_000, overShort: -5_000 },
        });
        await expect(service.current(ANA)).resolves.toBeNull();
        // The stored report is what the cashier can reopen later.
        await expect(service.lastClosed(ANA)).resolves.toEqual(report);
    });

    it('refuses without an open shift', async () => {
        await expect(service.closeOwn(ANA, FLOAT_COUNTS)).rejects.toMatchObject(
            {
                statusCode: 409,
                code: ErrorCode.SHIFT_NOT_OPEN,
            },
        );
    });

    it('refuses a close whose shift was closed underneath it, and writes nothing', async () => {
        const { _id } = await service.open(ANA, FLOAT_COUNTS);
        // The OPEN-filtered flip finds nothing: another close won.
        jest.spyOn(shifts, 'findOneAndUpdate').mockReturnValueOnce(
            new FakeModel().findOneAndUpdate({}, {}),
        );

        await expect(service.closeOwn(ANA, FLOAT_COUNTS)).rejects.toMatchObject(
            { code: ErrorCode.SHIFT_NOT_OPEN },
        );
        expect(shifts.byId(_id)!.status).toBe(ShiftStatus.OPEN);
    });

    it('flips the status with an OPEN filter', async () => {
        const { _id } = await service.open(ANA, FLOAT_COUNTS);
        const spy = jest.spyOn(shifts, 'findOneAndUpdate');

        await service.closeOwn(ANA, FLOAT_COUNTS);

        expect(spy.mock.calls[0][0]).toEqual({
            _id: new Types.ObjectId(_id),
            status: ShiftStatus.OPEN,
        });
    });
});

describe('ShiftService.lastClosed', () => {
    it('is null before any shift closed', async () => {
        await service.open(ANA, FLOAT_COUNTS);

        await expect(service.lastClosed(ANA)).resolves.toBeNull();
    });

    it('returns the cashier’s most recently closed shift only', async () => {
        await service.open(ANA, FLOAT_COUNTS);
        await service.closeOwn(ANA, FLOAT_COUNTS);
        const { _id: second } = await service.open(ANA, FLOAT_COUNTS);
        await service.closeOwn(ANA, countsOf(1_000));
        await service.open(BEN, FLOAT_COUNTS);
        await service.closeOwn(BEN, FLOAT_COUNTS);
        // Make the order unambiguous.
        shifts.byId(second)!.closedAt = new Date(Date.now() + 60_000);

        const report = await service.lastClosed(ANA);

        expect(report?.shiftId).toBe(second);
        expect(report?.cashierName).toBe('ana');
    });
});

describe('ShiftService.closeById (admin force-close)', () => {
    it('closes an abandoned shift with the admin’s count and records who closed it', async () => {
        const { _id } = await service.open(ANA, FLOAT_COUNTS);
        await ring(ANA, cashSale(10_000));

        const report = await service.closeById(BOSS, _id, countsOf(110_000));

        expect(report).toMatchObject({
            shiftId: _id,
            cashierName: 'ana',
            closedByName: 'boss',
            closedByAdmin: true,
            drawer: { expectedCash: 110_000, overShort: 0 },
        });
        expect(String(shifts.byId(_id)!.closedBy)).toBe(BOSS.userId);
        // The cashier sees the report, and has no open shift left.
        await expect(service.current(ANA)).resolves.toBeNull();
        await expect(service.lastClosed(ANA)).resolves.toMatchObject({
            closedByAdmin: true,
            closedByName: 'boss',
        });
    });

    it('does not mark an admin closing their own shift as a force-close', async () => {
        const { _id } = await service.open(BOSS, FLOAT_COUNTS);

        const report = await service.closeById(BOSS, _id, FLOAT_COUNTS);

        expect(report.closedByAdmin).toBe(false);
    });

    it('refuses a closed shift with 409 SHIFT_CLOSED', async () => {
        const { _id } = await service.open(ANA, FLOAT_COUNTS);
        await service.closeOwn(ANA, FLOAT_COUNTS);

        await expect(
            service.closeById(BOSS, _id, FLOAT_COUNTS),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: ErrorCode.SHIFT_CLOSED,
        });
    });

    it('404s an unknown shift', async () => {
        await expect(
            service.closeById(
                BOSS,
                new Types.ObjectId().toString(),
                FLOAT_COUNTS,
            ),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('ShiftService.payOutReversal', () => {
    function payOut(
        saleShift: Types.ObjectId | null,
        amount: number,
        payoutShiftId?: string,
    ) {
        return inTransaction((session) =>
            service.payOutReversal(
                {
                    saleId: String(new Types.ObjectId()),
                    saleShift,
                    amount,
                    payoutShiftId,
                    type: ReversalType.REFUND,
                    reason: 'return',
                    admin: BOSS,
                },
                session,
            ),
        );
    }

    function payouts(id: string) {
        return (
            shifts.byId(id)!.movements as { type: DrawerMovementType }[]
        ).filter((m) => m.type === DrawerMovementType.REVERSAL_PAYOUT);
    }

    it('touches no drawer when there is no cash to pay back', async () => {
        const { _id } = await service.open(ANA, FLOAT_COUNTS);

        await expect(payOut(new Types.ObjectId(_id), 0)).resolves.toBeNull();
        expect(payouts(_id)).toHaveLength(0);
    });

    it('still writes the open sale shift, in the session, for a cash-free reversal so a close conflicts', async () => {
        const { _id } = await service.open(ANA, FLOAT_COUNTS);
        const spy = jest.spyOn(shifts, 'updateOne');
        const session = { id: 'reversal-session' } as unknown as ClientSession;

        await service.payOutReversal(
            {
                saleId: String(new Types.ObjectId()),
                saleShift: new Types.ObjectId(_id),
                amount: 0,
                type: ReversalType.VOID,
                reason: 'x',
                admin: BOSS,
            },
            session,
        );

        expect(spy).toHaveBeenCalledWith(
            { _id: new Types.ObjectId(_id), status: ShiftStatus.OPEN },
            { $inc: { reversalCount: 1 } },
            { session },
        );
        expect(shifts.byId(_id)!.reversalCount).toBe(1);
        expect(payouts(_id)).toHaveLength(0);
    });

    it('leaves a closed sale shift alone for a cash-free reversal', async () => {
        const { _id } = await service.open(ANA, FLOAT_COUNTS);
        await service.closeOwn(ANA, FLOAT_COUNTS);
        const before = { ...shifts.byId(_id)! };

        await expect(payOut(new Types.ObjectId(_id), 0)).resolves.toBeNull();
        expect(shifts.byId(_id)).toEqual(before);
    });

    it('charges the sale’s own shift while it is open', async () => {
        const { _id } = await service.open(ANA, FLOAT_COUNTS);

        const charged = await payOut(new Types.ObjectId(_id), 30_000);

        expect(String(charged)).toBe(_id);
        expect(payouts(_id)).toEqual([
            expect.objectContaining({
                amount: 30_000,
                byName: 'boss',
                reason: 'REFUND: return',
            }),
        ]);
    });

    it('refuses a different payout shift while the sale’s own is open, and rolls back', async () => {
        const { _id } = await service.open(ANA, FLOAT_COUNTS);
        const { _id: other } = await service.open(BEN, FLOAT_COUNTS);

        await expect(
            payOut(new Types.ObjectId(_id), 30_000, other),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(payouts(_id)).toHaveLength(0);
        expect(payouts(other)).toHaveLength(0);
    });

    it('asks for a payout shift when the sale’s shift is closed', async () => {
        const { _id } = await service.open(ANA, FLOAT_COUNTS);
        await service.closeOwn(ANA, FLOAT_COUNTS);
        await service.open(BEN, FLOAT_COUNTS);

        await expect(
            payOut(new Types.ObjectId(_id), 30_000),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: ErrorCode.SHIFT_PAYOUT_REQUIRED,
            details: { openShifts: 1, shift: _id, amount: 30_000 },
        });
    });

    it('asks for a payout shift for a sale from before shifts', async () => {
        await service.open(BEN, FLOAT_COUNTS);

        await expect(payOut(null, 30_000)).rejects.toMatchObject({
            code: ErrorCode.SHIFT_PAYOUT_REQUIRED,
        });
    });

    it('refuses when no shift at all is open', async () => {
        const { _id } = await service.open(ANA, FLOAT_COUNTS);
        await service.closeOwn(ANA, FLOAT_COUNTS);

        await expect(
            payOut(new Types.ObjectId(_id), 30_000),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: ErrorCode.SHIFT_PAYOUT_NO_OPEN_SHIFT,
        });
    });

    it('charges the chosen open shift, cutting its expected cash, and leaves the closed Z-read alone', async () => {
        // Ana rings ₱300 cash and closes; the refund comes during Ben's shift.
        const { _id: anaShift } = await service.open(ANA, FLOAT_COUNTS);
        const sale = await ring(ANA, cashSale(30_000));
        const anaReport = await service.closeOwn(ANA, countsOf(130_000));
        const { _id: benShift } = await service.open(BEN, FLOAT_COUNTS);

        const charged = await payOut(
            new Types.ObjectId(anaShift),
            30_000,
            benShift,
        );
        sale.status = SaleStatus.REFUNDED;

        expect(String(charged)).toBe(benShift);
        expect(payouts(anaShift)).toHaveLength(0);
        // Ben's drawer handed back ₱300: ₱1,000 - ₱300 is expected.
        const benReport = await service.closeOwn(BEN, countsOf(70_000));
        expect(benReport.drawer).toMatchObject({
            reversalPayouts: { count: 1, amount: 30_000 },
            expectedCash: 70_000,
            overShort: 0,
        });
        expect(benReport.sales.count).toBe(0);
        // Ana's stored report is untouched.
        await expect(service.lastClosed(ANA)).resolves.toEqual(anaReport);
        expect(anaReport.drawer.expectedCash).toBe(130_000);
    });

    it('charges a chosen shift for a sale from before shifts', async () => {
        const { _id } = await service.open(BEN, FLOAT_COUNTS);

        await expect(payOut(null, 5_000, _id)).resolves.toEqual(
            new Types.ObjectId(_id),
        );
        expect(payouts(_id)).toHaveLength(1);
    });

    it('refuses a chosen shift that is closed', async () => {
        const { _id } = await service.open(BEN, FLOAT_COUNTS);
        await service.closeOwn(BEN, FLOAT_COUNTS);
        await service.open(ANA, FLOAT_COUNTS);

        await expect(payOut(null, 5_000, _id)).rejects.toMatchObject({
            statusCode: 409,
            code: ErrorCode.SHIFT_CLOSED,
        });
    });

    it('404s a chosen shift that does not exist', async () => {
        await service.open(ANA, FLOAT_COUNTS);

        await expect(
            payOut(null, 5_000, new Types.ObjectId().toString()),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('ShiftService.list and getById', () => {
    it('lists shifts newest first, paginated, open and closed', async () => {
        await service.open(ANA, FLOAT_COUNTS);
        await service.closeOwn(ANA, FLOAT_COUNTS);
        const { _id: newest } = await service.open(BEN, FLOAT_COUNTS);
        shifts.byId(newest)!.openedAt = new Date(Date.now() + 60_000);

        const page = await service.list({ page: 1, limit: 1 });

        expect(page.totalItems).toBe(2);
        expect(page.data).toHaveLength(1);
        expect(page.data[0]).toMatchObject({
            _id: newest,
            status: ShiftStatus.OPEN,
            report: null,
        });
        const second = await service.list({ page: 2, limit: 1 });
        expect(second.data[0]).toMatchObject({
            status: ShiftStatus.CLOSED,
            report: expect.objectContaining({ cashierName: 'ana' }),
        });
    });

    it('filters by status', async () => {
        await service.open(ANA, FLOAT_COUNTS);
        await service.closeOwn(ANA, FLOAT_COUNTS);
        await service.open(BEN, FLOAT_COUNTS);

        const open = await service.list({
            page: 1,
            limit: 10,
            status: ShiftStatus.OPEN,
        });

        expect(open.totalItems).toBe(1);
        expect(open.data[0].cashierName).toBe('ben');
    });

    it('404s an unknown shift', async () => {
        await expect(
            service.getById(new Types.ObjectId().toString()),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});
