import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import { User } from '../user/user.schema';
import { DiscountType, PaymentType } from './types';
import { NUMERIC_LIMITS, STRING_LIMITS } from '../constants';

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
        min: 1,
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

    @Prop({
        type: String,
        maxLength: STRING_LIMITS.REFERENCE_NUMBER,
    })
    referenceNumber?: string;

    @Prop({ type: SaleDiscountSchema, required: false })
    discount?: SaleDiscount;
}

export const SalesSchema = SchemaFactory.createForClass(Sales);
