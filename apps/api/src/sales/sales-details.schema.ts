import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Sales } from './sales.schema';
import mongoose, { Types } from 'mongoose';
import { Product } from '../product/product.schema';
import { NUMERIC_LIMITS } from '../constants';

@Schema()
export class SalesDetails {
    @Prop({
        required: true,
        type: mongoose.Schema.Types.ObjectId,
        ref: Sales.name,
        index: true,
    })
    sales!: Sales | Types.ObjectId;

    @Prop({
        required: true,
        type: mongoose.Schema.Types.ObjectId,
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
        min: NUMERIC_LIMITS.STOCK_MIN,
    })
    unitPrice!: number;
}

export const SalesDetailsSchema = SchemaFactory.createForClass(SalesDetails);
