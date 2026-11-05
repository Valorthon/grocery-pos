import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Category, type CategoryDoc, categoryNameKey } from './category.schema';
import { Product } from '../product/product.schema';
import {
    type CategoryQueryDto,
    type CreateCategoryDto,
    type UpdateCategoryDto,
} from './category.dto';
import { ErrorCode, NotFoundError, ValidationError } from '../common/errors';
import { runInTransaction } from '../common/utils/db';
import { containsRegex } from '../common/utils/regex';
@Injectable()
export class CategoryService implements OnModuleInit {
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(Category.name) private model: Model<Category>,
        @InjectModel(Product.name) private products: Model<Product>,
    ) {}
    /** Nest awaits this before listening: uniqueness must hold on the first request. */
    async onModuleInit(): Promise<void> {
        await this.model.init();
    }

    async list(dto: CategoryQueryDto) {
        const filter = {
            ...(dto.status === 'all'
                ? {}
                : { isActive: dto.status !== 'archived' }),
            ...(dto.name
                ? { nameKey: containsRegex(categoryNameKey(dto.name)) }
                : {}),
        };
        const [data, totalItems] = await Promise.all([
            this.model
                .find(filter)
                .sort({ sortOrder: 1, nameKey: 1, _id: 1 })
                .skip((dto.page - 1) * dto.limit)
                .limit(dto.limit)
                .lean<CategoryDoc[]>(),
            this.model.countDocuments(filter),
        ]);
        return { data, totalItems };
    }
    async create(dto: CreateCategoryDto) {
        return runInTransaction(async (session) => {
            const [row] = await this.model.create(
                [{ ...dto, nameKey: categoryNameKey(dto.name) }],
                { session },
            );
            return this.model
                .findById(row._id)
                .session(session)
                .lean<CategoryDoc>()
                .orFail();
        }, this.connection);
    }
    async update(id: string, dto: UpdateCategoryDto) {
        return runInTransaction(async (session) => {
            const row = await this.model
                .findByIdAndUpdate(
                    id,
                    {
                        $set: {
                            ...dto,
                            ...(dto.name !== undefined && {
                                nameKey: categoryNameKey(dto.name),
                            }),
                        },
                        $inc: { assignmentVersion: 1 },
                    },
                    { new: true, runValidators: true, session },
                )
                .lean<CategoryDoc>();
            if (!row)
                throw new NotFoundError(
                    ErrorCode.NOT_FOUND,
                    'Category not found',
                );
            return row;
        }, this.connection);
    }
    async remove(id: string) {
        await runInTransaction(async (session) => {
            const row = await this.model.findByIdAndUpdate(
                id,
                { $inc: { assignmentVersion: 1 } },
                { session },
            );
            if (!row)
                throw new NotFoundError(
                    ErrorCode.NOT_FOUND,
                    'Category not found',
                );
            // Retain every reference, including archived products, not just active rows.
            if (
                await this.products
                    .exists({ category: new Types.ObjectId(id) })
                    .session(session)
            )
                throw new ValidationError(
                    ErrorCode.VALIDATION_INVALID_INPUT,
                    'Category is used by products; archive it instead',
                );
            await this.model.deleteOne({ _id: id }, { session });
        }, this.connection);
    }
    /** Writes the category in the product transaction to serialize assignment with archive/delete. */
    async assertAssignable(id: string, session: ClientSession): Promise<void> {
        const result = await this.model.updateOne(
            { _id: id, isActive: true },
            { $inc: { assignmentVersion: 1 } },
            { session },
        );
        if (result.matchedCount !== 1)
            throw new ValidationError(
                ErrorCode.VALIDATION_INVALID_INPUT,
                'Choose an active category',
            );
    }
}
