import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
import {
    StockMovementSource,
    StockMovementType,
    UnitOfMeasure,
} from '@grocery-pos/contracts';

/** Append-only application ledger. No public write/update/delete endpoint. */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class StockMovement {
    createdAt!: Date;
    @Prop({ type: MongoSchema.Types.ObjectId, required: true, ref: 'Product' })
    product!: Types.ObjectId;
    @Prop({ type: String, required: true, enum: StockMovementType })
    type!: StockMovementType;
    @Prop({ type: Number, required: true, validate: Number.isSafeInteger })
    quantity!: number;
    @Prop({ type: Number, required: true, validate: Number.isSafeInteger })
    balanceAfter!: number;
    @Prop({ type: String, required: true, enum: UnitOfMeasure })
    unit!: UnitOfMeasure;
    @Prop({
        type: Number,
        required: true,
        min: 0,
        validate: Number.isSafeInteger,
    })
    sequence!: number;
    @Prop({ type: String, required: true, enum: StockMovementSource })
    refModel!: StockMovementSource;
    @Prop({ type: MongoSchema.Types.ObjectId })
    refId?: Types.ObjectId;
    @Prop({ type: MongoSchema.Types.ObjectId, ref: 'User' })
    user?: Types.ObjectId;
    @Prop({ type: Date, required: true })
    occurredAt!: Date;
    @Prop({ type: Boolean, required: true, default: false })
    historical!: boolean;
}
export const StockMovementSchema = SchemaFactory.createForClass(StockMovement);
StockMovementSchema.index({ product: 1, sequence: 1 }, { unique: true });
StockMovementSchema.index({ product: 1, createdAt: -1, sequence: -1 });
