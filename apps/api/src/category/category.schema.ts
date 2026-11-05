import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CATEGORY_NAME_MAX, CATEGORY_SORT_MAX } from '@grocery-pos/contracts';
import { Types } from 'mongoose';
@Schema({ timestamps: true })
export class Category {
    @Prop({
        type: String,
        required: true,
        maxlength: CATEGORY_NAME_MAX,
        trim: true,
    })
    name!: string;
    @Prop({ type: String, required: true, unique: true, select: false })
    nameKey!: string;
    @Prop({ type: Boolean, default: true, required: true })
    isActive!: boolean;
    @Prop({
        type: Number,
        default: 0,
        min: 0,
        max: CATEGORY_SORT_MAX,
        validate: Number.isInteger,
    })
    sortOrder!: number;
    @Prop({ type: Number, default: 0, select: false })
    assignmentVersion!: number;
}
export const CategorySchema = SchemaFactory.createForClass(Category);
export type CategoryDoc = Category & {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
};
export function categoryNameKey(name: string): string {
    return name.trim().toLowerCase();
}
