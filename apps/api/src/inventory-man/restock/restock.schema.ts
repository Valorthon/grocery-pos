import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import { User } from '../../user/user.schema';
import { NUMERIC_LIMITS, STRING_LIMITS } from '../../constants';
import type { NameRef } from '../../common/wire';

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
        // A restock of ₱0-cost lines only totals ₱0 (#85).
        min: NUMERIC_LIMITS.UNIT_COST_MIN,
        validate: {
            validator: Number.isInteger,
            message: 'totalCost must be an integer number of centavos',
        },
    })
    /** Centavos. */
    totalCost!: number;
}

export const RestockSchema = SchemaFactory.createForClass(Restock);

/** A restock read with `restockedBy` populated by name (null once deleted). */
export type RestockRowDoc = Omit<Restock, 'restockedBy'> & {
    _id: Types.ObjectId;
    restockedBy: NameRef | null;
    createdAt: Date;
    updatedAt: Date;
};
