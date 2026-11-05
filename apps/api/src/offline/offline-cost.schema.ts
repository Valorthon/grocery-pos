import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { NUMERIC_LIMITS, UnitOfMeasure } from '@grocery-pos/contracts';
import { Schema as MongoSchema, Types } from 'mongoose';

/** Immutable server-only cost evidence. Its opaque id, never the cost, is in a price proof. */
@Schema({ timestamps: true })
export class OfflineCost {
    @Prop({ type: MongoSchema.Types.ObjectId, required: true })
    lease!: Types.ObjectId;
    @Prop({ type: MongoSchema.Types.ObjectId, required: true })
    product!: Types.ObjectId;
    @Prop({ type: String, required: true, enum: Object.values(UnitOfMeasure) })
    unit!: UnitOfMeasure;
    @Prop({
        type: Number,
        min: 0,
        max: NUMERIC_LIMITS.AMOUNT_MAX,
        validate: Number.isSafeInteger,
    })
    unitCost?: number;
}
export const OfflineCostSchema = SchemaFactory.createForClass(OfflineCost);
