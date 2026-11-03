import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import { OverrideAction } from '@grocery-pos/contracts';

/**
 * A signed approval also needs this database claim: its consumption is a
 * conditional write in the same transaction as the sale or reversal. A JWT
 * alone cannot make an approval single-use across concurrent API instances.
 */
@Schema({ timestamps: true })
export class OverrideGrant {
    @Prop({ type: mongoose.Schema.Types.ObjectId, required: true })
    cashier!: Types.ObjectId;

    @Prop({ type: String, required: true })
    sessionId!: string;

    @Prop({ type: mongoose.Schema.Types.ObjectId, required: true })
    approver!: Types.ObjectId;

    /** Requester security edits also revoke a pending approval. */
    @Prop({ type: String, default: null })
    requesterVersion!: string | null;

    /** Changes whenever the admin sets or clears the approver's PIN. */
    @Prop({ type: String, required: true })
    approverPinVersion!: string;

    @Prop({ type: String, required: true, enum: OverrideAction })
    action!: OverrideAction;

    /** Canonical action inputs plus the server's monetary snapshot. */
    @Prop({ type: String, required: true })
    contextHash!: string;

    @Prop({ type: Date, required: true })
    expiresAt!: Date;

    @Prop({ type: Date, default: null })
    consumedAt!: Date | null;
}

export const OverrideGrantSchema = SchemaFactory.createForClass(OverrideGrant);

// Cleanup only. Every consume query must also check expiresAt > now.
OverrideGrantSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
