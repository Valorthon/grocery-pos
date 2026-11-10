import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SETTINGS_LIMITS } from '@grocery-pos/contracts';

@Schema({ timestamps: true })
export class Settings {
    @Prop({ type: Number, default: 0, select: false }) contextLock!: number;
    @Prop({ type: String, required: true, unique: true, immutable: true })
    key!: string;
    @Prop({
        type: String,
        required: true,
        maxlength: SETTINGS_LIMITS.STORE_NAME,
    })
    storeName!: string;
    @Prop({ type: String, default: '', maxlength: SETTINGS_LIMITS.BRANCH_NAME })
    branchName!: string;
    @Prop({ type: String, default: '', maxlength: SETTINGS_LIMITS.ADDRESS })
    address!: string;
    @Prop({ type: String, default: '', maxlength: SETTINGS_LIMITS.CONTACT })
    contactNumber!: string;
    @Prop({ type: String, default: '', maxlength: SETTINGS_LIMITS.TIN })
    tin!: string;
    @Prop({ type: String, default: '', maxlength: SETTINGS_LIMITS.FOOTER })
    receiptFooter!: string;
    @Prop({ type: String, required: true, maxlength: SETTINGS_LIMITS.TIMEZONE })
    timezone!: string;
    @Prop({ type: String, required: true }) currency!: string;
    @Prop({
        type: Number,
        required: true,
        min: 0,
        max: SETTINGS_LIMITS.REORDER_LEVEL,
        validate: Number.isInteger,
    })
    defaultReorderLevel!: number;
    /** Absent on rows saved before #213; read as the default. */
    @Prop({
        type: Number,
        min: SETTINGS_LIMITS.EXPIRY_ALERT_DAYS_MIN,
        max: SETTINGS_LIMITS.EXPIRY_ALERT_DAYS_MAX,
        validate: Number.isInteger,
    })
    expiryAlertDays?: number;
    @Prop({
        type: Number,
        required: true,
        default: 0,
        min: 0,
        validate: Number.isInteger,
    })
    version!: number;
}
export const SettingsSchema = SchemaFactory.createForClass(Settings);
