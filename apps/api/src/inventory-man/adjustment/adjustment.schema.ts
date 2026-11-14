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
    })
    adjustedBy!: User | Types.ObjectId;
}

export const AdjustmentSchema = SchemaFactory.createForClass(Adjustment);
// History pages and dashboard activity share descending date order (#339).
AdjustmentSchema.index({ createdAt: -1 });
AdjustmentSchema.index({ adjustedBy: 1, createdAt: -1 });

/** An adjustment read with `adjustedBy` populated by name (null once deleted). */
export type AdjustmentRowDoc = Omit<Adjustment, 'adjustedBy'> & {
    _id: Types.ObjectId;
    adjustedBy: NameRef | null;
    createdAt: Date;
    updatedAt: Date;
};
