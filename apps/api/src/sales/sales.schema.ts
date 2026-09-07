import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import { User } from '../user/user.schema';
import { PaymentType } from './types';
import { NUMERIC_LIMITS, STRING_LIMITS } from '../constants';

@Schema({ timestamps: true })
export class Sales {
    @Prop({
        type: Number,
        min: NUMERIC_LIMITS.AMOUNT_MIN,
        required: true,
    })
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
}

export const SalesSchema = SchemaFactory.createForClass(Sales);
