import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { EAN_COUNTER } from '../constants';

@Schema()
export class EANCounter {
    @Prop({
        type: String,
        required: true,
        default: 'EAN_COUNTER_ID',
    })
    _id!: string;

    @Prop({
        type: Number,
        required: true,
        default: EAN_COUNTER.STARTING_VALUE,
    })
    counter!: number;

    @Prop({
        type: Number,
        required: true,
        default: EAN_COUNTER.PREFIX,
    })
    prefix!: number;
}

export const EANCounterSchema = SchemaFactory.createForClass(EANCounter);
