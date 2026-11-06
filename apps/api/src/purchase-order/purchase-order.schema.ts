import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Types } from 'mongoose';
import {
    PURCHASE_ORDER_LIMITS,
    PurchaseOrderStatus,
    UnitOfMeasure,
} from '@grocery-pos/contracts';

const integer = {
    validator: Number.isSafeInteger,
    message: '{PATH} must be a safe integer',
};

@Schema({ _id: true })
export class PurchaseOrderLine {
    _id!: Types.ObjectId;
    @Prop({
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
    })
    product!: Types.ObjectId;
    /** Snapshot of the product's immutable unit (#36). */
    @Prop({ type: String, enum: Object.values(UnitOfMeasure), required: true })
    unit!: UnitOfMeasure;
    @Prop({ type: Number, required: true, min: 1, validate: integer })
    orderedQty!: number;
    @Prop({
        type: Number,
        required: true,
        min: 0,
        default: 0,
        validate: integer,
    })
    receivedQty!: number;
    /** Centavos per displayed unit. */
    @Prop({ type: Number, required: true, min: 0, validate: integer })
    expectedCost!: number;
}
const PurchaseOrderLineSchema = SchemaFactory.createForClass(PurchaseOrderLine);

@Schema({ _id: false })
export class PurchaseOrderReceipt {
    /** Private idempotency key of the receive attempt; never on the wire. */
    @Prop({ type: String, required: true })
    key!: string;
    /** Hash of the normalized receive request (`receiveRequestHash`). */
    @Prop({ type: String, required: true })
    requestHash!: string;
    @Prop({
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Restock',
        required: true,
    })
    restock!: Types.ObjectId;
}
const PurchaseOrderReceiptSchema =
    SchemaFactory.createForClass(PurchaseOrderReceipt);

@Schema({ timestamps: true })
export class PurchaseOrder {
    @Prop({
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Supplier',
        required: true,
        index: true,
    })
    supplier!: Types.ObjectId;
    @Prop({
        type: String,
        enum: Object.values(PurchaseOrderStatus),
        required: true,
        default: PurchaseOrderStatus.DRAFT,
    })
    status!: PurchaseOrderStatus;
    @Prop({ type: Number, required: true, default: 0 })
    version!: number;
    @Prop({ type: String, trim: true, maxlength: PURCHASE_ORDER_LIMITS.NOTE })
    note?: string;
    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true })
    createdBy!: Types.ObjectId;
    @Prop({ type: Date }) sentAt?: Date;
    @Prop({ type: Date }) cancelledAt?: Date;
    @Prop({ type: Boolean, default: false }) closedShort!: boolean;
    @Prop({ type: [PurchaseOrderLineSchema], required: true })
    lines!: PurchaseOrderLine[];
    @Prop({ type: [PurchaseOrderReceiptSchema], default: [] })
    receipts!: PurchaseOrderReceipt[];
}
export const PurchaseOrderSchema = SchemaFactory.createForClass(PurchaseOrder);
PurchaseOrderSchema.index({ status: 1, createdAt: -1 });
PurchaseOrderSchema.index({ createdAt: -1, _id: -1 });

export type PurchaseOrderDoc = PurchaseOrder & {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
};
