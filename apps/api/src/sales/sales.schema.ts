import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import { User } from '../user/user.schema';
import {
    DiscountType,
    PaymentType,
    ReversalType,
    SaleStatus,
    TenderType,
} from './types';
import {
    DISCOUNT_LIMITS,
    NUMERIC_LIMITS,
    REFERENCE_NUMBER_LIMITS,
    REVERSED_SALE_STATUSES,
    STRING_LIMITS,
} from '../constants';

const centavos = (field: string) => ({
    validator: Number.isInteger,
    message: `${field} must be an integer number of centavos`,
});

/**
 * A whole-sale discount as the server applied it. The discount lives here,
 * not on SalesDetails: each line keeps its undiscounted `unitPrice` snapshot,
 * and `Sales.amount` is the charged total (subtotal - discount.amount).
 */
@Schema({ _id: false })
export class SaleDiscount {
    @Prop({ required: true, enum: Object.values(DiscountType), type: String })
    type!: DiscountType;

    /** A whole percent for PERCENT, centavos for FIXED, as requested. */
    @Prop({
        type: Number,
        required: true,
        validate: {
            validator: Number.isInteger,
            message: 'discount value must be an integer',
        },
    })
    value!: number;

    @Prop({ type: String, required: true, maxLength: STRING_LIMITS.REASON })
    reason!: string;

    /** Centavos taken off the subtotal. */
    @Prop({
        type: Number,
        required: true,
        min: DISCOUNT_LIMITS.AMOUNT_MIN,
        validate: {
            validator: Number.isInteger,
            message: 'discount amount must be an integer number of centavos',
        },
    })
    amount!: number;

    /**
     * Who authorized the discount. Today that is the cashier ringing the sale;
     * a manager override (PIN) can later record a different user here.
     */
    @Prop({
        required: true,
        type: mongoose.Schema.Types.ObjectId,
        ref: User.name,
    })
    approvedBy!: User | Types.ObjectId;
}

export const SaleDiscountSchema = SchemaFactory.createForClass(SaleDiscount);

/**
 * One way the customer paid. A CASH tender's `amount` is the cash handed
 * over, so it can exceed what it pays for; the excess is `Sales.changeGiven`.
 * A GCASH tender's `amount` is what was transferred and never exceeds the
 * total. The GCash reference number is on the sale (`Sales.referenceNumber`):
 * a sale has at most one GCASH tender.
 */
@Schema({ _id: false })
export class SaleTender {
    @Prop({ required: true, enum: Object.values(TenderType), type: String })
    type!: TenderType;

    /** Centavos. */
    @Prop({
        type: Number,
        required: true,
        min: NUMERIC_LIMITS.AMOUNT_MIN,
        validate: centavos('tender amount'),
    })
    amount!: number;
}

export const SaleTenderSchema = SchemaFactory.createForClass(SaleTender);

/**
 * How a sale was reversed. This is the link later ledger (#45), audit (#46)
 * and manager-approval (#34) work builds on.
 */
@Schema({ _id: false })
export class SaleReversal {
    @Prop({ required: true, enum: Object.values(ReversalType), type: String })
    type!: ReversalType;

    @Prop({ type: String, required: true, maxLength: STRING_LIMITS.REASON })
    reason!: string;

    /** The admin who reversed the sale. */
    @Prop({
        required: true,
        type: mongoose.Schema.Types.ObjectId,
        ref: User.name,
    })
    approvedBy!: User | Types.ObjectId;

    @Prop({ type: Date, required: true })
    at!: Date;
}

export const SaleReversalSchema = SchemaFactory.createForClass(SaleReversal);

@Schema({ timestamps: true })
export class Sales {
    @Prop({
        type: Number,
        min: NUMERIC_LIMITS.AMOUNT_MIN,
        required: true,
        validate: {
            validator: Number.isInteger,
            message: 'amount must be an integer number of centavos',
        },
    })
    /** Centavos: the charged total, after any discount. */
    amount!: number;

    @Prop({
        required: true,
        type: mongoose.Schema.Types.ObjectId,
        ref: User.name,
    })
    cashier!: User | Types.ObjectId;

    @Prop({
        required: true,
        enum: Object.values(PaymentType),
        type: String,
        index: true,
    })
    paymentType!: PaymentType;

    /**
     * The GCash reference number, digits only. Required for GCASH and SPLIT
     * sales, absent for CASH; unique across sales (see the index below).
     */
    @Prop({
        type: String,
        maxLength: REFERENCE_NUMBER_LIMITS.MAX_LENGTH,
    })
    referenceNumber?: string;

    @Prop({ type: SaleDiscountSchema, required: false })
    discount?: SaleDiscount;

    /**
     * What the customer paid with. Sales written before tenders existed have
     * none; their `paymentType` is all that is known.
     */
    @Prop({ type: [SaleTenderSchema], default: undefined })
    tenders?: SaleTender[];

    /** Centavos: the sum of the tenders. */
    @Prop({ type: Number, min: 0, validate: centavos('amountTendered') })
    amountTendered?: number;

    /** Centavos: `amountTendered - amount`, always paid out of the cash tender. */
    @Prop({ type: Number, min: 0, validate: centavos('changeGiven') })
    changeGiven?: number;

    @Prop({
        type: String,
        enum: Object.values(SaleStatus),
        default: SaleStatus.COMPLETED,
        index: true,
    })
    status!: SaleStatus;

    /** Set when the sale is voided or refunded. */
    @Prop({ type: SaleReversalSchema, required: false })
    reversal?: SaleReversal;

    createdAt!: Date;
    updatedAt!: Date;
}

export const SalesSchema = SchemaFactory.createForClass(Sales);

// One sale per GCash transfer. Partial so the many sales without a
// reference (every CASH sale) do not collide on a missing value.
SalesSchema.index(
    { referenceNumber: 1 },
    {
        unique: true,
        partialFilterExpression: { referenceNumber: { $type: 'string' } },
    },
);

/**
 * Matches sales that count toward revenue. Written as "not reversed" rather
 * than `status: COMPLETED` so sales stored before `status` existed count.
 */
export const COUNTED_SALES_FILTER = {
    status: { $nin: [...REVERSED_SALE_STATUSES] },
};
