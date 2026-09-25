import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
    type BillCounts,
    billCountTotal,
    type CurrentShiftView,
    DEFAULT_TERMINAL,
    type DrawerMovementView,
    DrawerMovementType,
    type Paginated,
    ReversalType,
    SHIFT_LIMITS,
    type ShiftListItem,
    ShiftStatus,
    type ZReadReport,
} from '@grocery-pos/contracts';
import { AuthUser } from '../auth/types';
import {
    ConflictError,
    ErrorCode,
    NotFoundError,
    ValidationError,
} from '../common/errors';
import { runInTransaction } from '../common/utils/db';
import { NUMERIC_LIMITS, STRING_LIMITS } from '../constants';
import { isDuplicateKey } from '../sales/idempotency';
import { Sales } from '../sales/sales.schema';
import { DrawerMovement, Shift } from './shift.schema';
import { DrawerMovementDto, ListShiftsDto } from './types';
import { computeZRead, ShiftSale } from './z-read';

type ShiftDoc = Shift & { _id: Types.ObjectId };

/** The stored Z-read: the report without the movements, which stay on the shift. */
type StoredZRead = Omit<ZReadReport, 'movements'>;

const CASHIER_MOVEMENTS: readonly DrawerMovementType[] = [
    DrawerMovementType.CASH_IN,
    DrawerMovementType.CASH_DROP,
];

/** The sale fields a Z-read needs. */
const SALE_FIELDS = {
    amount: 1,
    paymentType: 1,
    tenders: 1,
    changeGiven: 1,
    status: 1,
    discount: 1,
} as const;

function toMovementView(m: DrawerMovement): DrawerMovementView {
    return {
        type: m.type,
        amount: m.amount,
        reason: m.reason,
        at: new Date(m.at).toISOString(),
        byName: m.byName,
        sale: m.sale ? String(m.sale) : null,
    };
}

/**
 * The cashier's view of their open shift: blind, so no expected cash, no
 * sales totals, and no payouts an ADMIN charged to it.
 */
export function toCurrentView(shift: ShiftDoc): CurrentShiftView {
    return {
        _id: String(shift._id),
        status: shift.status,
        cashierName: shift.cashierName,
        terminal: shift.terminal,
        openedAt: new Date(shift.openedAt).toISOString(),
        openingFloat: shift.openingFloat,
        movements: (shift.movements ?? [])
            .filter((m) => CASHIER_MOVEMENTS.includes(m.type))
            .map(toMovementView),
    };
}

/** The stored Z-read of a closed shift, with its movements. */
export function toReport(shift: ShiftDoc): ZReadReport | null {
    if (shift.status !== ShiftStatus.CLOSED || !shift.zRead) return null;
    return {
        ...(shift.zRead as unknown as StoredZRead),
        movements: (shift.movements ?? []).map(toMovementView),
    };
}

function toListItem(shift: ShiftDoc): ShiftListItem {
    return {
        _id: String(shift._id),
        status: shift.status,
        cashierName: shift.cashierName,
        terminal: shift.terminal,
        openedAt: new Date(shift.openedAt).toISOString(),
        closedAt: shift.closedAt
            ? new Date(shift.closedAt).toISOString()
            : null,
        openingFloat: shift.openingFloat,
        report: toReport(shift),
    };
}

/** Adds up a count, refusing a total the ledger would not accept. */
function countedTotal(counts: BillCounts): number {
    const total = billCountTotal(counts);
    if (total > NUMERIC_LIMITS.AMOUNT_MAX) {
        throw new ValidationError(
            ErrorCode.VALIDATION_INVALID_INPUT,
            'The counted cash is more than any drawer can hold',
            { total },
        );
    }
    return total;
}

/**
 * Server-side cash shifts (issue #2).
 *
 * - A cashier has at most one OPEN shift (a unique partial index), opened
 *   with a positive counted float. It survives logout; the same cashier
 *   resumes it, nobody else inherits it.
 * - Every sale is written into the cashier's open shift in the sale's own
 *   transaction (`chargeSale`), and closing flips the status in a
 *   transaction with a `status: OPEN` filter, so a sale and a close of the
 *   same shift conflict instead of one missing the other.
 * - Closing is a blind count: the server computes expected cash and the
 *   Z-read, and stores it on the shift.
 */
@Injectable()
export class ShiftService {
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(Shift.name) private model: Model<Shift>,
        @InjectModel(Sales.name) private salesModel: Model<Sales>,
    ) {}

    private openFilter(cashier: string) {
        return {
            cashier: new Types.ObjectId(cashier),
            status: ShiftStatus.OPEN,
        };
    }

    /** Opens a shift for the caller with the counted float. */
    async open(user: AuthUser, counts: BillCounts): Promise<CurrentShiftView> {
        const openingFloat = countedTotal(counts);
        if (openingFloat < SHIFT_LIMITS.OPENING_FLOAT_MIN) {
            throw new ValidationError(
                ErrorCode.VALIDATION_INVALID_INPUT,
                'Count the opening float: a shift opens with cash in the drawer',
                { openingFloat },
            );
        }

        const existing = await this.model
            .findOne(this.openFilter(user.userId), { _id: 1 })
            .lean();
        if (existing) throw this.alreadyOpen();

        try {
            const created = await this.model.create({
                cashier: new Types.ObjectId(user.userId),
                cashierName: user.username,
                terminal: DEFAULT_TERMINAL,
                status: ShiftStatus.OPEN,
                openedAt: new Date(),
                openingFloat,
                openingCounts: counts,
                movements: [],
                saleCount: 0,
            });
            return toCurrentView(created.toObject());
        } catch (err) {
            // A concurrent open by the same cashier won the unique index.
            if (isDuplicateKey(err, 'cashier')) throw this.alreadyOpen();
            throw err;
        }
    }

    private alreadyOpen() {
        return new ConflictError(
            ErrorCode.SHIFT_ALREADY_OPEN,
            'You already have an open shift',
        );
    }

    private notOpen() {
        return new ConflictError(
            ErrorCode.SHIFT_NOT_OPEN,
            'You have no open shift. Open a shift first.',
        );
    }

    /** The caller's open shift, blind, or null. */
    async current(user: AuthUser): Promise<CurrentShiftView | null> {
        const shift = await this.model
            .findOne(this.openFilter(user.userId))
            .lean<ShiftDoc>();
        return shift ? toCurrentView(shift) : null;
    }

    /** The id of `cashier`'s open shift, or null. */
    async openShiftIdOf(cashier: string): Promise<Types.ObjectId | null> {
        const shift = await this.model
            .findOne(this.openFilter(cashier), { _id: 1 })
            .lean<{ _id: Types.ObjectId }>();
        return shift?._id ?? null;
    }

    /**
     * Records a cash in or cash drop on the caller's open shift. A drop is
     * never checked against expected cash: a shortfall shows up as
     * variance at close.
     */
    async recordDrawer(
        user: AuthUser,
        dto: DrawerMovementDto,
    ): Promise<CurrentShiftView> {
        const movement: DrawerMovement = {
            type: dto.type,
            amount: dto.amount,
            reason: dto.reason,
            at: new Date(),
            by: new Types.ObjectId(user.userId),
            byName: user.username,
        };

        const shift = await this.model
            .findOneAndUpdate(
                this.openFilter(user.userId),
                { $push: { movements: movement } },
                { new: true, runValidators: true },
            )
            .lean<ShiftDoc>();

        if (!shift) throw this.notOpen();
        return toCurrentView(shift);
    }

    /**
     * Records a sale into `cashier`'s open shift, inside the sale's
     * transaction, and returns the shift's id for `Sales.shift`.
     *
     * The write is filtered on `status: OPEN`: no open shift is a 409
     * SHIFT_NOT_OPEN, and a shift that closes concurrently write-conflicts
     * with this update, so the sale either lands before the close (and is
     * in its Z-read) or retries and is refused.
     */
    async chargeSale(
        cashier: string,
        session: ClientSession,
    ): Promise<Types.ObjectId> {
        const shift = await this.model
            .findOneAndUpdate(
                this.openFilter(cashier),
                { $inc: { saleCount: 1 } },
                { session, new: true, projection: { _id: 1 } },
            )
            .lean<{ _id: Types.ObjectId }>();

        if (!shift) throw this.notOpen();
        return shift._id;
    }

    /**
     * Takes a void or refund's cash out of a drawer, inside the reversal's
     * transaction. Returns the shift charged, or null when there was no cash
     * to pay back (GCash only), in which case no drawer is touched.
     *
     * The sale's own shift pays while it is open. Once it is closed (or for
     * a sale from before shifts), the ADMIN names an open shift with
     * `payoutShiftId`; without one this refuses with SHIFT_PAYOUT_REQUIRED,
     * or SHIFT_PAYOUT_NO_OPEN_SHIFT when none is open. Refusing throws, so
     * the reversal's transaction rolls back and nothing changes.
     */
    async payOutReversal(
        {
            saleId,
            saleShift,
            amount,
            payoutShiftId,
            type,
            reason,
            admin,
        }: {
            saleId: string;
            saleShift: Types.ObjectId | null;
            /** Centavos: the sale's net cash. */
            amount: number;
            payoutShiftId?: string;
            type: ReversalType;
            reason: string;
            admin: AuthUser;
        },
        session: ClientSession,
    ): Promise<Types.ObjectId | null> {
        if (amount <= 0) return null;

        const movement: DrawerMovement = {
            type: DrawerMovementType.REVERSAL_PAYOUT,
            amount,
            reason: `${type}: ${reason}`.slice(0, STRING_LIMITS.REASON),
            at: new Date(),
            by: new Types.ObjectId(admin.userId),
            byName: admin.username,
            sale: new Types.ObjectId(saleId),
        };

        if (
            saleShift &&
            (await this.pushIfOpen(saleShift, movement, session))
        ) {
            if (payoutShiftId && payoutShiftId !== String(saleShift)) {
                throw new ValidationError(
                    ErrorCode.VALIDATION_INVALID_INPUT,
                    "The sale's own shift is still open and pays the cash back",
                    { shift: String(saleShift), payoutShiftId },
                );
            }
            return saleShift;
        }

        if (!payoutShiftId) {
            const openShifts = await this.model
                .countDocuments({ status: ShiftStatus.OPEN })
                .session(session);
            if (openShifts === 0) {
                throw new ConflictError(
                    ErrorCode.SHIFT_PAYOUT_NO_OPEN_SHIFT,
                    'No shift is open to pay the cash back from. Open a shift first.',
                    { amount },
                );
            }
            throw new ConflictError(
                ErrorCode.SHIFT_PAYOUT_REQUIRED,
                saleShift
                    ? "The sale's shift is closed: choose an open shift to pay the cash back from"
                    : 'The sale has no shift: choose an open shift to pay the cash back from',
                {
                    amount,
                    openShifts,
                    shift: saleShift ? String(saleShift) : null,
                },
            );
        }

        const payoutShift = new Types.ObjectId(payoutShiftId);
        if (await this.pushIfOpen(payoutShift, movement, session)) {
            return payoutShift;
        }

        const exists = await this.model
            .exists({ _id: payoutShift })
            .session(session);
        if (!exists) {
            throw new NotFoundError(ErrorCode.NOT_FOUND, 'Shift not found', {
                shift: payoutShiftId,
            });
        }
        throw new ConflictError(
            ErrorCode.SHIFT_CLOSED,
            'That shift is closed: choose an open shift',
            { shift: payoutShiftId },
        );
    }

    /** Pushes `movement` onto the shift only while it is OPEN. */
    private async pushIfOpen(
        shift: Types.ObjectId,
        movement: DrawerMovement,
        session: ClientSession,
    ): Promise<boolean> {
        const res = await this.model.updateOne(
            { _id: shift, status: ShiftStatus.OPEN },
            { $push: { movements: movement } },
            { session, runValidators: true },
        );
        return res.matchedCount > 0;
    }

    /** The caller closes their own open shift with a blind count. */
    async closeOwn(
        user: AuthUser,
        counts: BillCounts,
        session?: ClientSession,
    ): Promise<ZReadReport> {
        const countedCash = countedTotal(counts);
        return runInTransaction(
            async (session) => {
                const shift = await this.model
                    .findOne(this.openFilter(user.userId))
                    .session(session)
                    .lean<ShiftDoc>();
                if (!shift) throw this.notOpen();
                return this.close(shift, user, counts, countedCash, session);
            },
            this.connection,
            session,
        );
    }

    /**
     * An ADMIN closes any open shift (usually one a cashier abandoned) with
     * the count they made. The Z-read records who closed it.
     */
    async closeById(
        admin: AuthUser,
        id: string,
        counts: BillCounts,
        session?: ClientSession,
    ): Promise<ZReadReport> {
        const countedCash = countedTotal(counts);
        return runInTransaction(
            async (session) => {
                const shift = await this.model
                    .findById(id)
                    .session(session)
                    .lean<ShiftDoc>();
                if (!shift) {
                    throw new NotFoundError(
                        ErrorCode.NOT_FOUND,
                        'Shift not found',
                        { shift: id },
                    );
                }
                if (shift.status !== ShiftStatus.OPEN) throw this.closed(id);
                return this.close(shift, admin, counts, countedCash, session);
            },
            this.connection,
            session,
        );
    }

    private closed(id: string) {
        return new ConflictError(
            ErrorCode.SHIFT_CLOSED,
            'This shift is already closed',
            { shift: id },
        );
    }

    /**
     * Computes the Z-read from the shift's movements and every sale rung
     * into it, read in the closing transaction, and flips the shift to
     * CLOSED with a `status: OPEN` filter. A sale, movement or close
     * committed after this transaction read the shift makes the final
     * update write-conflict, and the transaction is retried from the top.
     */
    private async close(
        shift: ShiftDoc,
        closer: AuthUser,
        counts: BillCounts,
        countedCash: number,
        session: ClientSession,
    ): Promise<ZReadReport> {
        const sales = await this.salesModel
            .find({ shift: shift._id }, SALE_FIELDS)
            .session(session)
            .lean<ShiftSale[]>();

        const closedAt = new Date();
        const zRead: StoredZRead = {
            shiftId: String(shift._id),
            cashierName: shift.cashierName,
            terminal: shift.terminal,
            openedAt: new Date(shift.openedAt).toISOString(),
            closedAt: closedAt.toISOString(),
            closedByName: closer.username,
            closedByAdmin: String(shift.cashier) !== closer.userId,
            ...computeZRead(shift, sales, countedCash),
        };

        const closed = await this.model
            .findOneAndUpdate(
                { _id: shift._id, status: ShiftStatus.OPEN },
                {
                    $set: {
                        status: ShiftStatus.CLOSED,
                        closedAt,
                        closedBy: new Types.ObjectId(closer.userId),
                        closingCounts: counts,
                        zRead,
                    },
                },
                { session, new: true },
            )
            .lean<ShiftDoc>();

        if (!closed) {
            throw String(shift.cashier) === closer.userId
                ? this.notOpen()
                : this.closed(String(shift._id));
        }
        return toReport(closed)!;
    }

    /** The caller's most recently closed shift's Z-read, or null. */
    async lastClosed(user: AuthUser): Promise<ZReadReport | null> {
        const shift = await this.model
            .findOne({
                cashier: new Types.ObjectId(user.userId),
                status: ShiftStatus.CLOSED,
            })
            .sort({ closedAt: -1 })
            .lean<ShiftDoc>();
        return shift ? toReport(shift) : null;
    }

    /** Every shift, newest first; ADMIN only. */
    async list(dto: ListShiftsDto): Promise<Paginated<ShiftListItem>> {
        const { page, limit, status } = dto;
        const filter = status ? { status } : {};

        const [rows, totalItems] = await Promise.all([
            this.model
                .find(filter)
                .sort({ openedAt: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean<ShiftDoc[]>(),
            this.model.countDocuments(filter),
        ]);

        return { data: rows.map(toListItem), totalItems };
    }

    /** One shift with its Z-read if closed; ADMIN only. */
    async getById(id: string): Promise<ShiftListItem> {
        const shift = await this.model.findById(id).lean<ShiftDoc>();
        if (!shift) {
            throw new NotFoundError(ErrorCode.NOT_FOUND, 'Shift not found', {
                shift: id,
            });
        }
        return toListItem(shift);
    }
}
