import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import { User } from '../../user/user.schema';
import { STRING_LIMITS } from '../../constants';
import type { NameRef } from '../../common/wire';

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

/** An adjustment read with `adjustedBy` populated by name (null once deleted). */
export type AdjustmentRowDoc = Omit<Adjustment, 'adjustedBy'> & {
    _id: Types.ObjectId;
    adjustedBy: NameRef | null;
    createdAt: Date;
    updatedAt: Date;
};
