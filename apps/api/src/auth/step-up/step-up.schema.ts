import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';

/**
 * A step-up re-authentication (#310): the user re-entered their own password
 * in session `sid` and may make sensitive account changes from it until
 * `expiresAt`. Keyed by the session id rather than a refresh token, so
 * refresh rotation keeps it. Revoking the session deletes it.
 */
@Schema({ timestamps: true })
export class StepUp {
    @Prop({ type: mongoose.Schema.Types.ObjectId, required: true })
    user!: Types.ObjectId;

    /** The session (refresh-token family) id, the access token's `sid`. */
    @Prop({ type: String, required: true })
    sid!: string;

    @Prop({ type: Date, required: true })
    expiresAt!: Date;
}

export const StepUpSchema = SchemaFactory.createForClass(StepUp);

StepUpSchema.index({ user: 1, sid: 1 }, { unique: true });
// Cleanup only: every check also compares expiresAt with now.
StepUpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
