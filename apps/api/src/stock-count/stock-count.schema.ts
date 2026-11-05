import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
import {
    STOCK_COUNT_LINE_MAX,
    StockCountStatus,
    UnitOfMeasure,
} from '@grocery-pos/contracts';

@Schema()
export class StockCountLine {
    _id!: Types.ObjectId;
    @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Product', required: true })
    product!: Types.ObjectId;
    @Prop({ type: String, required: true }) name!: string;
    @Prop({ type: String, required: true }) EAN!: string;
    @Prop({ type: String, enum: UnitOfMeasure, required: true })
    unit!: UnitOfMeasure;
    @Prop({ type: Boolean, required: true }) tracksExpiry!: boolean;
    @Prop({ type: MongoSchema.Types.ObjectId, ref: 'InventoryBatch' })
    batch?: Types.ObjectId;
    @Prop({ type: String }) batchNo?: string;
    @Prop({ type: String }) expiryDate?: string;
    @Prop({ type: Number, required: true, validate: Number.isSafeInteger })
    expectedQty!: number;
    @Prop({
        type: Number,
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        validate: Number.isSafeInteger,
    })
    countedQty?: number;
}
const StockCountLineSchema = SchemaFactory.createForClass(StockCountLine);
@Schema({ timestamps: true })
export class StockCount {
    _id!: Types.ObjectId;
    createdAt!: Date;
    updatedAt!: Date;
    @Prop({
        type: String,
        enum: ['all', 'category', 'products'],
        required: true,
    })
    scope!: 'all' | 'category' | 'products';
    @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Category' })
    category?: Types.ObjectId;
    @Prop({
        type: String,
        enum: StockCountStatus,
        default: StockCountStatus.OPEN,
        required: true,
    })
    status!: StockCountStatus;
    @Prop({
        type: Number,
        min: 0,
        default: 0,
        required: true,
        validate: Number.isSafeInteger,
    })
    version!: number;
    @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User', required: true })
    createdBy!: Types.ObjectId;
    @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User' })
    approvedBy?: Types.ObjectId;
    @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Adjustment' })
    adjustment?: Types.ObjectId;
    @Prop({
        type: [StockCountLineSchema],
        required: true,
        validate: (lines: unknown[]) =>
            lines.length > 0 && lines.length <= STOCK_COUNT_LINE_MAX,
    })
    lines!: StockCountLine[];
}
export const StockCountSchema = SchemaFactory.createForClass(StockCount);
StockCountSchema.index({ createdAt: -1, _id: -1 });
