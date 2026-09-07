import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Inventory } from './inventory.schema';
import { ClientSession, Model, Types } from 'mongoose';
import { RestockDto, RestockFields } from '../restock/types';
import { AdjustDto } from '../adjustment/types';
import { SellDto } from '../../sales/types';
import { ProductService } from '../../product/product.service';
import { NewProductFields } from '../../product/types';
import { AuthUser } from '../../auth/types';
import { GetAllDto } from './types';
import { ErrorCode, ValidationError } from '../../common/errors';

@Injectable()
export class InventoryService {
    constructor(
        @InjectModel(Inventory.name) private model: Model<Inventory>,
        @Inject(forwardRef(() => ProductService))
        private productService: ProductService,
    ) {}

    async getAll(
        dto: GetAllDto,
    ): Promise<{ data: Inventory[]; totalItems: number }> {
        const { page, limit, maxStock } = dto;

        if (maxStock) {
            const skip = (page - 1) * limit;

            const matchQuery = { stock: { $lte: maxStock } };

            const [data, totalItems] = await Promise.all([
                this.model.aggregate<Inventory>([
                    { $match: matchQuery },
                    {
                        $lookup: {
                            from: 'products',
                            localField: 'product',
                            foreignField: '_id',
                            as: 'product',
                        },
                    },
                    { $unwind: '$product' },
                    { $sort: { 'product.name': 1, _id: 1 } },
                    { $skip: skip },
                    { $limit: limit },
                ]),

                this.model.countDocuments(matchQuery),
            ]);

            Logger.log('MAX STOCK', { data });
            return {
                data,
                totalItems,
            };
        }

        const { productIds, totalItems } =
            await this.productService.getAllExec(dto);

        const data = await this.model
            .find({
                product: { $in: productIds },
            })
            .populate('product')
            .lean();

        return {
            data,
            totalItems,
        };
    }

    async restock(user: AuthUser, dto: RestockDto, session: ClientSession) {
        const { restockDetails } = dto;

        const newProducts = restockDetails
            .filter(
                (d): d is RestockFields & { newProduct: NewProductFields } =>
                    !!d.newProduct,
            )
            .map((details) => details.newProduct);

        const EANMap = await this.productService.createMany(
            newProducts,
            session,
        );

        const missingProducts = [];
        const updatedRestockDetails = [];

        for (const [index, details] of restockDetails.entries()) {
            if (!(
                details.product ||
                (details.newProduct?.EAN && EANMap[details.newProduct.EAN])
            )) {
                missingProducts.push({
                    index,
                    EAN: details.newProduct?.EAN,
                    name: details.newProduct?.name,
                });

                continue;
            }

            const product = details.product ?? EANMap[details.newProduct!.EAN];

            updatedRestockDetails.push({
                product: new Types.ObjectId(product),
                quantity: details.quantity,
                updatedBy: new Types.ObjectId(user.userId),
                unitCost: details.unitCost,
            });
        }

        if (missingProducts.length > 0) {
            throw new ValidationError(
                ErrorCode.VALIDATION_INVALID_INPUT,
                'Unresolved new Products',
                missingProducts,
            );
        }

        const updates = updatedRestockDetails
            .filter(({ product }) => !!product)
            .map(({ product, quantity, updatedBy }) => ({
                updateOne: {
                    filter: { product },
                    update: {
                        $inc: { stock: quantity },
                        $setOnInsert: { updatedBy, product },
                    },
                    upsert: true,
                },
            }));

        await this.model.bulkWrite(updates, { session });

        return updatedRestockDetails;
    }

    async adjust(dto: AdjustDto, session: ClientSession): Promise<void> {
        const { adjustDetails } = dto;

        const updates = adjustDetails.map(({ product, change }) => ({
            updateOne: {
                filter: { product },
                update: { $inc: { stock: change } },
            },
        }));

        await this.model.bulkWrite(updates, { session });
    }

    async sell(dto: SellDto, session: ClientSession): Promise<void> {
        const { sellDetails } = dto;

        const updates = sellDetails.map(({ product, quantity }) => ({
            updateOne: {
                // The $gte guard belongs in the filter: Mongoose's `min` validator
                // does not run on update operators, so an unguarded $inc will
                // happily drive stock negative when a sale oversells.
                filter: { product, stock: { $gte: quantity } },
                update: { $inc: { stock: -quantity } },
            },
        }));

        const result = await this.model.bulkWrite(updates, { session });

        if (result.matchedCount !== updates.length) {
            await this.throwInsufficientStock(sellDetails, session);
        }
    }

    /**
     * Called when a guarded sell matched fewer rows than it tried to update.
     * Re-reads the affected inventory inside the same transaction to report
     * exactly which products were short, rather than a bare count mismatch.
     */
    private async throwInsufficientStock(
        sellDetails: SellDto['sellDetails'],
        session: ClientSession,
    ): Promise<never> {
        const rows = await this.model
            .find({ product: { $in: sellDetails.map((d) => d.product) } })
            .populate<{ product: { _id: Types.ObjectId; name: string } }>({
                path: 'product',
                select: 'name',
            })
            .session(session)
            .lean();

        const stockByProduct = new Map(
            rows
                .filter((row) => row.product?._id)
                .map((row) => [
                    row.product._id.toString(),
                    { name: row.product.name, stock: row.stock },
                ]),
        );

        const shortfalls = sellDetails
            .map(({ product, quantity }) => {
                const current = stockByProduct.get(product.toString());
                return {
                    product: product.toString(),
                    name: current?.name,
                    requested: quantity,
                    available: current?.stock ?? 0,
                };
            })
            .filter((item) => item.available < item.requested);

        throw new ValidationError(
            ErrorCode.VALIDATION_INVALID_INPUT,
            'Insufficient stock for one or more products',
            shortfalls,
        );
    }

    async createMany(
        productIds: Types.ObjectId[],
        userId: Types.ObjectId,
        session?: ClientSession,
    ) {
        const commonFields = {
            stock: 0,
            updatedBy: userId,
        };

        const toInsert = productIds.map((id) => ({
            product: id,
            ...commonFields,
        }));

        await this.model.insertMany(toInsert, { session });
    }
}
