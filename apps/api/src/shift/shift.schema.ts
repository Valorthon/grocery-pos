import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import {
    DrawerMovementType,
    ShiftStatus,
    type BillCounts,
} from '@grocery-pos/contracts';
import { User } from '../user/user.schema';
import { NUMERIC_LIMITS, STRING_LIMITS } from '../constants';

const centavos = (field: string) => ({
    validator: Number.isInteger,
    message: `${field} must be an integer number of centavos`,
});

/** Cash in, a cash drop, or a void/refund payout, on one shift's drawer. */
@Schema({ _id: false })
export class DrawerMovement {
    @Prop({
        required: true,
        enum: Object.values(DrawerMovementType),
        type: String,
    })
    type!: DrawerMovementType;

    /** Centavos, always positive; `type` gives the direction. */
    @Prop({
        type: Number,
        required: true,
        min: NUMERIC_LIMITS.AMOUNT_MIN,
        max: NUMERIC_LIMITS.AMOUNT_MAX,
        validate: centavos('movement amount'),
    })
    amount!: number;

    @Prop({ type: String, required: true, maxLength: STRING_LIMITS.REASON })
    reason!: string;

    @Prop({ type: Date, required: true })
    at!: Date;

    /** Who recorded it: the cashier, or the ADMIN for a payout. */
    @Prop({
        required: true,
        type: mongoose.Schema.Types.ObjectId,
        ref: User.name,
    })
    by!: Types.ObjectId;

    /** Username of `by` when it was recorded, for the report. */
    @Prop({ type: String, required: true })
    byName!: string;

    /** For REVERSAL_PAYOUT: the voided or refunded sale. */
    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Sales' })
    sale?: Types.ObjectId;
}

export const DrawerMovementSchema =
    SchemaFactory.createForClass(DrawerMovement);

/**
 * One cashier's cash shift (issue #2). At most one OPEN shift per cashier
 * (see the index below). Sales reference it (`Sales.shift`), drawer
 * movements live on it, and the Z-read is stored on it when it closes.
 */
@Schema({ timestamps: true })
export class Shift {
    @Prop({
        required: true,
        type: mongoose.Schema.Types.ObjectId,
        ref: User.name,
    })
    cashier!: Types.ObjectId;

    /** The cashier's username at open, for reports. */
    @Prop({ type: String, required: true })
    cashierName!: string;

    /** A label until terminals get an identity (#47). */
    @Prop({ type: String, required: true })
    terminal!: string;

    @Prop({
        type: String,
        enum: Object.values(ShiftStatus),
        required: true,
        default: ShiftStatus.OPEN,
        index: true,
    })
    status!: ShiftStatus;

    @Prop({ type: Date, required: true })
    openedAt!: Date;

    /** Centavos: the total of `openingCounts`. */
    @Prop({
        type: Number,
        required: true,
        min: NUMERIC_LIMITS.AMOUNT_MIN,
        validate: centavos('openingFloat'),
    })
    openingFloat!: number;

    /** Pieces per denomination counted in at open. */
    @Prop({ type: Object, required: true })
    openingCounts!: BillCounts;

    @Prop({ type: [DrawerMovementSchema], default: [] })
    movements!: DrawerMovement[];

    /**
     * Sales recorded into the shift. Bumped by every `POST /sales` inside its
     * transaction, with a `status: OPEN` filter, so a sale and a close of the
     * same shift write the same document and cannot both commit unseen.
     */
    @Prop({ type: Number, default: 0 })
    saleCount!: number;

    @Prop({ type: Date })
    closedAt?: Date;

    /** Who submitted the closing count: the cashier, or an ADMIN. */
    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: User.name })
    closedBy?: Types.ObjectId;

    /** Pieces per denomination counted at close. */
    @Prop({ type: Object })
    closingCounts?: BillCounts;

    /**
     * The Z-read (`ZReadReport` in contracts, without `movements`), computed
     * and stored in the closing transaction. Never recomputed.
     */
    @Prop({ type: Object })
    zRead?: Record<string, unknown>;

    createdAt!: Date;
    updatedAt!: Date;
}

export const ShiftSchema = SchemaFactory.createForClass(Shift);

// At most one open shift per cashier. Partial, so any number of CLOSED
// shifts coexist. Opening a second one is refused with SHIFT_ALREADY_OPEN
// (the duplicate key is caught in ShiftService.open).
ShiftSchema.index(
    { cashier: 1 },
    {
        unique: true,
        partialFilterExpression: { status: ShiftStatus.OPEN },
        name: 'one_open_shift_per_cashier',
    },
);

// The ADMIN list, newest first, optionally by status.
ShiftSchema.index({ status: 1, openedAt: -1 });
ShiftSchema.index({ openedAt: -1 });
// A cashier's last closed shift.
ShiftSchema.index({ cashier: 1, status: 1, closedAt: -1 });
