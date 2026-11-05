import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SUPPLIER_LIMITS } from '@grocery-pos/contracts';
import { Types } from 'mongoose';

@Schema({ timestamps: true })
export class Supplier {
    @Prop({
        type: String,
        required: true,
        trim: true,
        maxlength: SUPPLIER_LIMITS.NAME,
    })
    name!: string;
    @Prop({ type: String, trim: true, maxlength: SUPPLIER_LIMITS.CONTACT })
    contactPerson?: string;
    @Prop({ type: String, trim: true, maxlength: SUPPLIER_LIMITS.PHONE })
    phone?: string;
    @Prop({ type: String, trim: true, maxlength: SUPPLIER_LIMITS.EMAIL })
    email?: string;
    @Prop({ type: String, trim: true, maxlength: SUPPLIER_LIMITS.ADDRESS })
    address?: string;
    @Prop({ type: String, trim: true, maxlength: SUPPLIER_LIMITS.TIN })
    TIN?: string;
    @Prop({ type: Boolean, default: true, required: true })
    isActive!: boolean;
    @Prop({ type: Number, default: 0, select: false })
    receiptVersion!: number;
}
export const SupplierSchema = SchemaFactory.createForClass(Supplier);
export type SupplierDoc = Supplier & {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
};
