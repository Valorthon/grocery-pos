import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import { User } from '../../user/user.schema';
import { STRING_LIMITS } from '../../constants';

@Schema({ timestamps: true })
export class Adjustment {
    @Prop({
        type: String,
        required: true,
        maxLength: STRING_LIMITS.DESCRIPTION,
        trim: true,
    })
    description!: string;

    @Prop({
        required: true,
        type: mongoose.Schema.ObjectId,
        ref: User.name,
        index: true,
    })
    adjustedBy!: User | Types.ObjectId;
}

export const AdjustmentSchema = SchemaFactory.createForClass(Adjustment);
