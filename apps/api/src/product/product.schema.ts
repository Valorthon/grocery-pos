import { UnitOfMeasure } from '@grocery-pos/contracts';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Types } from 'mongoose';
import { Category } from './types';
import { NUMERIC_LIMITS, STRING_LIMITS } from '../constants';

@Schema({ timestamps: true })
export class Product {
    @Prop({ type: Number, select: false })
    saleVersion?: number;
    @Prop({ type: Boolean, default: true })
    isActive?: boolean;

    @Prop({
        type: [
            { oldPrice: Number, newPrice: Number, changedBy: String, at: Date },
        ],
        default: undefined,
        select: false,
    })
    priceHistory?: {
        oldPrice: number;
        newPrice: number;
        changedBy: string;
        at: Date;
    }[];

    @Prop({
        type: String,
        enum: Object.values(UnitOfMeasure),
        default: UnitOfMeasure.PIECE,
        immutable: true,
    })
    unit?: UnitOfMeasure;

    @Prop({
        type: String,
        required: true,
        unique: true,
        maxLength: STRING_LIMITS.EAN,
    })
    EAN!: string;

    @Prop({
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        maxLength: STRING_LIMITS.PRODUCT_NAME,
    })
    name!: string;

    @Prop({
        type: Number,
        required: true,
        min: NUMERIC_LIMITS.PRICE_MIN,
        validate: {
            validator: Number.isInteger,
            message: 'price must be an integer number of centavos',
        },
    })
    /** Centavos. */
    price!: number;

    @Prop({
        required: false,
        enum: Object.values(Category),
        type: String,
    })
    category!: Category;
}

export const ProductSchema = SchemaFactory.createForClass(Product);

/** A product as a `.lean()` read returns it, with its timestamps. */
export type ProductDoc = Product & {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
};
