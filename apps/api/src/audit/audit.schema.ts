import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
import {
    AuditAction,
    AUDIT_LIMITS,
    type AuditValue,
} from '@grocery-pos/contracts';

@Schema({ minimize: false, timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
    createdAt!: Date;
    @Prop({ type: MongoSchema.Types.ObjectId, default: null })
    actor!: Types.ObjectId | null;
    @Prop({ type: String, default: null }) actorName!: string | null;
    @Prop({ type: String, enum: AuditAction, required: true })
    action!: AuditAction;
    @Prop({ type: String, required: true }) targetModel!: string;
    @Prop({ type: MongoSchema.Types.ObjectId, default: null })
    targetId!: Types.ObjectId | null;
    @Prop({ type: MongoSchema.Types.Mixed, default: () => ({}) })
    before!: Record<string, AuditValue>;
    @Prop({ type: MongoSchema.Types.Mixed, default: () => ({}) })
    after!: Record<string, AuditValue>;
    @Prop({ type: MongoSchema.Types.ObjectId, default: null })
    approvedBy!: Types.ObjectId | null;
    @Prop({ type: String, maxlength: AUDIT_LIMITS.IP, default: null }) ip!:
        string | null;
    @Prop({ type: String, maxlength: AUDIT_LIMITS.USER_AGENT, default: null })
    userAgent!: string | null;
}
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1, _id: -1 });
AuditLogSchema.index({ actor: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
const rejectMutation = () => {
    throw new Error('Audit entries are append-only');
};
AuditLogSchema.pre('updateOne', rejectMutation);
AuditLogSchema.pre('updateMany', rejectMutation);
AuditLogSchema.pre('findOneAndUpdate', rejectMutation);
AuditLogSchema.pre('replaceOne', rejectMutation);
AuditLogSchema.pre('findOneAndReplace', rejectMutation);
AuditLogSchema.pre('deleteOne', rejectMutation);
AuditLogSchema.pre('deleteMany', rejectMutation);
AuditLogSchema.pre('findOneAndDelete', rejectMutation);
AuditLogSchema.pre('save', function () {
    if (!this.isNew) rejectMutation();
});
AuditLogSchema.pre('bulkWrite', rejectMutation);

AuditLogSchema.pre(
    'deleteOne',
    { document: true, query: false },
    rejectMutation,
);
