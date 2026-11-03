import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';

/** Retained for verifying delayed cash uploads, including admin reconciliation. */
@Schema({ timestamps: true })
export class OfflineLease {
    @Prop({ type: MongoSchema.Types.ObjectId, required: true })
    cashier!: Types.ObjectId;
    @Prop({ type: MongoSchema.Types.ObjectId, required: true })
    shift!: Types.ObjectId;
    @Prop({ type: String, required: true }) sid!: string;
    @Prop({ type: String, required: true }) terminalId!: string;
    @Prop({ type: String }) securityVersion?: string;
    @Prop({ type: Date, required: true }) issuedAt!: Date;
    @Prop({ type: Date, required: true }) expiresAt!: Date;
    @Prop({ type: Boolean, default: true }) active!: boolean;
    @Prop({ type: Number, default: 0 }) syncLock!: number;
}
export const OfflineLeaseSchema = SchemaFactory.createForClass(OfflineLease);
OfflineLeaseSchema.index(
    { cashier: 1, shift: 1, sid: 1, terminalId: 1 },
    { unique: true, partialFilterExpression: { active: true } },
);
OfflineLeaseSchema.index({ shift: 1, active: 1 });
