import { EXPIRY_LIMITS } from '@grocery-pos/contracts';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';

@Schema({ timestamps: true })
export class InventoryBatch {
    createdAt!: Date;
    updatedAt!: Date;
    @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Product', required: true })
    product!: Types.ObjectId;
    @Prop({ type: MongoSchema.Types.ObjectId, ref: 'RestockDetails' })
    restockDetail?: Types.ObjectId;
    @Prop({ type: String, maxlength: EXPIRY_LIMITS.BATCH_NO })
    batchNo?: string;
    @Prop({ type: String })
    expiryDate?: string;
    @Prop({
        type: Number,
        required: true,
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        validate: Number.isSafeInteger,
    })
    receivedQty!: number;
    @Prop({
        type: Number,
        required: true,
        min: Number.MIN_SAFE_INTEGER,
        max: Number.MAX_SAFE_INTEGER,
        validate: Number.isSafeInteger,
    })
    remainingQty!: number;
    @Prop({ type: Boolean, default: false })
    reconciliation!: boolean;
}
export const InventoryBatchSchema =
    SchemaFactory.createForClass(InventoryBatch);
InventoryBatchSchema.index({ product: 1, expiryDate: 1, createdAt: 1, _id: 1 });
InventoryBatchSchema.index({ expiryDate: 1, remainingQty: 1 });
