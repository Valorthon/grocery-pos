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

    @Prop({
        type: Date,
        required: true,
    })
    expiry!: Date;

    @Prop({
        type: Boolean,
        required: true,
        default: true,
    })
    isValid!: boolean;
}

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
