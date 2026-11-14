import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Types } from 'mongoose';
import { ASSIGNABLE_ROLES } from '@grocery-pos/contracts';
import { Role } from '../auth/types/auth.types';
import { STRING_LIMITS } from '../constants';

@Schema({ timestamps: true })
export class User {
    @Prop({
        type: String,
        unique: true,
        required: true,
        lowercase: true,
        maxlength: STRING_LIMITS.USERNAME,
        trim: true,
    })
    name!: string;

    @Prop({
        type: [String],
        // Not `Role`: UNAUTHENTICATED is never a stored role.
        enum: ASSIGNABLE_ROLES,
        required: true,
    })
    roles!: Role[];

    @Prop({
        type: String,
        required: true,
    })
    passwordHash!: string;

    @Prop({ type: String, select: false })
    overridePinHash?: string;

    @Prop({ type: String, select: false })
    overridePinVersion?: string;

    /** Serializes approval consumption with role, activation and PIN changes. */
    @Prop({ type: Number, default: 0, select: false })
    overrideApprovalLock?: number;

    @Prop({
        type: Boolean,
        required: true,
        default: true,
    })
    isActive!: boolean;

    /**
     * Set only on the bootstrap ADMIN (#361) until they replace the
     * temporary password; absent (false) on every other account.
     */
    @Prop({ type: Boolean })
    mustChangePassword?: boolean;

    /**
     * Write-lock counter, bumped on every active ADMIN by a transaction that
     * may remove an admin, so concurrent ones write-conflict (issue #3).
     * Carries no meaning of its own.
     */
    @Prop({ type: Number, default: 0, select: false })
    adminLock?: number;
}

export const UserSchema = SchemaFactory.createForClass(User);

/**
 * An account as `GET /users` reads it: never the password hash (nor
 * `adminLock`, which the schema never selects).
 */
export type UserViewDoc = Omit<
    User,
    | 'passwordHash'
    | 'adminLock'
    | 'overridePinHash'
    | 'overridePinVersion'
    | 'overrideApprovalLock'
> & {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
};
