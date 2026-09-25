import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import { Product } from '../../product/product.schema';
import { Restock } from './restock.schema';
import { NUMERIC_LIMITS } from '../../constants';

@Schema()
export class RestockDetails {
    @Prop({
        required: true,
        type: mongoose.Schema.ObjectId,
        ref: Restock.name,
        index: true,
    })
    restock!: Types.ObjectId;

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
        min: NUMERIC_LIMITS.STOCK_MIN,
        validate: {
            validator: Number.isInteger,
            message: 'quantity must be an integer',
        },
    })
    quantity!: number;

    @Prop({
        type: Number,
        required: true,
        min: NUMERIC_LIMITS.PRICE_MIN,
        validate: {
            validator: Number.isInteger,
            message: 'unitCost must be an integer number of centavos',
        },
    })
    /** Centavos. */
    unitCost!: number;
}

export const RestockDetailsSchema =
    SchemaFactory.createForClass(RestockDetails);
