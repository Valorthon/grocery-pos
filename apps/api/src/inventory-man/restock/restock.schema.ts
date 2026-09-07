import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import { User } from '../../user/user.schema';
import { NUMERIC_LIMITS, STRING_LIMITS } from '../../constants';

@Schema({ timestamps: true })
export class Restock {
    @Prop({
        type: String,
        required: true,
        maxLength: STRING_LIMITS.DESCRIPTION,
        trim: true,
    })
    description!: string;

    @Prop({
        type: mongoose.Schema.ObjectId,
        ref: User.name,
        required: true,
        index: true,
    })
    restockedBy!: User | Types.ObjectId;

    @Prop({
        type: Number,
        required: true,
        min: NUMERIC_LIMITS.PRICE_MIN,
    })
    totalCost!: number;
}

export const RestockSchema = SchemaFactory.createForClass(Restock);
