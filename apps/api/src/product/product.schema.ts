import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Category } from './types';
import { NUMERIC_LIMITS, STRING_LIMITS } from '../constants';

@Schema({ timestamps: true })
export class Product {
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
    })
    price!: number;

    @Prop({
        required: false,
        enum: Object.values(Category),
        type: String,
    })
    category!: Category;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
