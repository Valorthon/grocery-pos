import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import { Adjustment } from './adjustment.schema';
import { Product } from '../../product/product.schema';
import { VALIDATION, STRING_LIMITS } from '../../constants';

@Schema()
export class AdjustmentDetails {
    @Prop({
        required: true,
        type: mongoose.Schema.ObjectId,
        ref: Adjustment.name,
        index: true,
    })
    adjustment!: Adjustment | Types.ObjectId;

    @Prop({
        required: true,
        type: mongoose.Schema.ObjectId,
        ref: Product.name,
        index: true,
    })
    product!: Product | Types.ObjectId;

    @Prop({
        type: Number,
        required: true,
        validate: [
            {
                validator: Number.isInteger,
                message: 'Change must be an integer',
            },
            {
                validator: (value: number) =>
                    value !== VALIDATION.CHANGE_NOT_ZERO,
                message: 'Change must not be 0',
            },
        ],
    })
    change!: number;

    @Prop({
        type: String,
        required: true,
        maxLength: STRING_LIMITS.REASON,
        trim: true,
    })
    reason!: string;
}

export const AdjustmentDetailsSchema =
    SchemaFactory.createForClass(AdjustmentDetails);
