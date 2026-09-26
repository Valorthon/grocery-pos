import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import { Product } from '../../product/product.schema';
import { User } from '../../user/user.schema';
import { NUMERIC_LIMITS } from '../../constants';
import type { ProductDoc } from '../../product/product.schema';

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

// Serves the dashboard's stock tiles (`stock <= LOW_STOCK_THRESHOLD`) and
// the inventory list's `maxStock` filter without a collection scan.
InventorySchema.index({ stock: 1 });

/** An inventory row joined to its product (`GET /inventories`). */
export type InventoryRowDoc = Omit<Inventory, 'product' | 'updatedBy'> & {
    _id: Types.ObjectId;
    product: ProductDoc;
    updatedBy: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
};
