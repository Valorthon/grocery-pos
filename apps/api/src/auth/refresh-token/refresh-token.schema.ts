import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import { User } from '../../user/user.schema';

@Schema()
export class RefreshToken {
    @Prop({
        type: mongoose.Schema.ObjectId,
        ref: User.name,
        required: true,
        index: true,
    })
    user!: User | Types.ObjectId;

    /**
     * Absolute end of the session. Rotation carries it over unchanged, and
     * the TTL index below makes MongoDB delete the row once it passes, so
     * abandoned sessions do not pile up (the TTL monitor runs about once a
     * minute; `rotate` checks the expiry itself, so a late sweep grants
     * nothing).
     */
    @Prop({
        type: Date,
        required: true,
    })
    expiry!: Date;

    /**
     * Session id: set at login and carried over by every rotation, so all
     * tokens of one sign-in share it. Access tokens carry it as `sid`, which
     * lets `PATCH /users/me/password` revoke the user's other sessions but
     * keep the caller's. Missing on rows created before it existed.
     */
    @Prop({
        type: mongoose.Schema.ObjectId,
        required: false,
    })
    family?: Types.ObjectId;
}

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);

RefreshTokenSchema.index({ expiry: 1 }, { expireAfterSeconds: 0 });
