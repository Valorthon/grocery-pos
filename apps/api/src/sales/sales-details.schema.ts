import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Sales } from './sales.schema';
import mongoose, { Types } from 'mongoose';
import { Product } from '../product/product.schema';
import { NUMERIC_LIMITS } from '../constants';
import type { NameRef } from '../common/wire';

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
        min: NUMERIC_LIMITS.PRICE_MIN,
        validate: {
            validator: Number.isInteger,
            message: 'unitPrice must be an integer number of centavos',
        },
    })
    /** Centavos. */
    unitPrice!: number;
}

export const SalesDetailsSchema = SchemaFactory.createForClass(SalesDetails);

/** A sale line read with its product populated by name (null once deleted). */
export type SaleLineDoc = Omit<SalesDetails, 'sales' | 'product'> & {
    _id: Types.ObjectId;
    sales: Types.ObjectId;
    product: NameRef | null;
};
