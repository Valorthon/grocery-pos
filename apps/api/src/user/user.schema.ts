import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
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

    @Prop({
        type: Boolean,
        required: true,
        default: true,
    })
    isActive!: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
