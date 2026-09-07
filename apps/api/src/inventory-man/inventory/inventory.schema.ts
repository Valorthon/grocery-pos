import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import { Product } from '../../product/product.schema';
import { User } from '../../user/user.schema';
import { NUMERIC_LIMITS } from '../../constants';

@Schema({ timestamps: true })
export class Inventory {
    @Prop({
        type: mongoose.Schema.Types.ObjectId,
        ref: Product.name,
        required: true,
        unique: true,
        index: true,
    })
    product!: Product | Types.ObjectId;

    @Prop({
        type: Number,
        required: true,
        min: NUMERIC_LIMITS.STOCK_MIN,
        default: NUMERIC_LIMITS.STOCK_MIN,
        validate: {
            validator: Number.isInteger,
            message: `Stock must be an integer`,
        },
    })
    stock!: number;

    @Prop({
        type: mongoose.Schema.Types.ObjectId,
        ref: User.name,
        required: true,
        index: true,
    })
    updatedBy!: User | Types.ObjectId;
}

export const InventorySchema = SchemaFactory.createForClass(Inventory);
