import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Inventory } from './inventory.schema';
import { ClientSession, Model, PipelineStage, Types } from 'mongoose';
import { RestockDto } from '../restock/types';
import { AdjustDto } from '../adjustment/types';
import { SellDto } from '../../sales/types';
import { ProductService } from '../../product/product.service';
import { productSearchFilter } from '../../product/product-search';
import { AuthUser } from '../../auth/types';
import { GetAllDto } from './types';
import {
    ErrorCode,
    InternalError,
    NotFoundError,
    ValidationError,
} from '../../common/errors';

/**
 * The aggregation behind `GET /inventories` (see InventoryService.getAll).
 * Exported so specs can pin its shape; its behaviour needs a real MongoDB.
 */
export function inventoryListPipeline(dto: GetAllDto): PipelineStage[] {
    const { page, limit, maxStock, name, EAN } = dto;
    const productFilter = productSearchFilter({ name, EAN }, 'product.');

    return [
        ...(maxStock !== undefined && maxStock !== null
            ? [{ $match: { stock: { $lte: maxStock } } }]
            : []),
        {
            $lookup: {
                from: 'products',
                localField: 'product',
                foreignField: '_id',
                as: 'product',
            },
        },
        // No preserveNullAndEmptyArrays: an orphan row (its product gone)
        // is dropped here, before both the count and the page.
        { $unwind: '$product' },
        ...(Object.keys(productFilter).length > 0
            ? [{ $match: productFilter }]
            : []),
        {
            $facet: {
                metadata: [{ $count: 'total' }],
                data: [
                    { $sort: { 'product.name': 1, _id: 1 } },
                    { $skip: (page - 1) * limit },
                    { $limit: limit },
                ],
            },
        },
    ];
}

@Injectable()
export class InventoryService {
    constructor(
        @InjectModel(Inventory.name) private model: Model<Inventory>,
        @Inject(forwardRef(() => ProductService))
        private productService: ProductService,
    ) {}

    /**
     * The inventory list, one page sorted by product name (then row id),
     * with `totalItems` counted over exactly the rows that can appear.
     *
     * One pipeline over inventory rows joined to their product:
     * - `maxStock` (0 included: "out of stock") keeps rows at or below it;
     * - `name` matches anywhere in the name, `EAN` as a barcode prefix,
     *   the same search as the product list (`productSearchFilter`);
     * - the inner `$unwind` drops orphans (rows whose product is gone), and
     *   a product with no inventory row never appears, so the `$facet` count
     *   and the page agree (issue #14).
     */
    async getAll(
        dto: GetAllDto,
    ): Promise<{ data: Inventory[]; totalItems: number }> {
        const [result] = await this.model.aggregate<{
            data: Inventory[];
            metadata: { total: number }[];
        }>(inventoryListPipeline(dto));

        return {
            data: result?.data ?? [],
            totalItems: result?.metadata[0]?.total ?? 0,
        };
    }

    /**
     * Applies a restock's stock increments. Each line names an existing
     * `product` or a `newProduct` to create (exactly one; RestockFields).
     * An existing product that does not exist is a 404 PRODUCT_NOT_FOUND
     * before anything is written, so a bogus or deleted id can never
     * upsert an orphan inventory row. Must run inside the restock's
     * transaction: the check reads through `session`.
     */
    async restock(user: AuthUser, dto: RestockDto, session: ClientSession) {
        const { restockDetails } = dto;
        const updatedBy = new Types.ObjectId(user.userId);

        const existingIds = restockDetails.flatMap((details) =>
            details.product ? [details.product] : [],
        );
        const found = await this.productService.getMany(existingIds, session);
        const unknown = restockDetails
            .map((details, index) => ({ index, product: details.product }))
            .filter(
                (line): line is { index: number; product: string } =>
                    !!line.product &&
                    // getMany keys by the canonical (lowercase) hex id.
                    !found.has(new Types.ObjectId(line.product).toString()),
            );
        if (unknown.length > 0) {
            throw new NotFoundError(
                ErrorCode.PRODUCT_NOT_FOUND,
                'One or more products do not exist',
                unknown,
            );
        }

        const newProducts = restockDetails.flatMap((details) =>
            details.newProduct ? [details.newProduct] : [],
        );
        // Ids come back in the order given; createMany never writes the
        // generated EANs into the DTO, so ids are matched by position.
        const newIds = await this.productService.createMany(
            newProducts,
            session,
        );
        if (newIds.length !== newProducts.length) {
            throw new InternalError('Restock did not create every product', {
                expected: newProducts.length,
                created: newIds.length,
            });
        }

        let nextNew = 0;
        const updatedRestockDetails = restockDetails.map((details) => ({
            product: details.newProduct
                ? newIds[nextNew++]
                : new Types.ObjectId(details.product),
            quantity: details.quantity,
            updatedBy,
            unitCost: details.unitCost,
        }));

        const updates = updatedRestockDetails.map(({ product, quantity }) => ({
            updateOne: {
                filter: { product },
                update: {
                    $inc: { stock: quantity },
                    $set: { updatedBy },
                    $setOnInsert: { product },
                },
                upsert: true,
            },
        }));

        const result = await this.model.bulkWrite(updates, { session });

        // Every op upserts, so each one either matches an existing row or
        // inserts a new one. Anything short of that means a write was lost.
        if (result.matchedCount + result.upsertedCount !== updates.length) {
            throw new InternalError(
                'Restock was not applied to every product',
                {
                    expected: updates.length,
                    matched: result.matchedCount,
                    upserted: result.upsertedCount,
                },
            );
        }

        return updatedRestockDetails;
    }

    /**
     * Applies an adjustment. Rejects with 404 if any product has no inventory
     * row and with 400 if any product's net change would drive stock negative.
     * Must run inside a transaction: on a 400, ops before the failing one have
     * already applied and are undone only when the transaction aborts.
     */
    async adjust(
        userId: string,
        dto: AdjustDto,
        session: ClientSession,
    ): Promise<void> {
        await this.applyChanges(
            dto.adjustDetails.map(({ product, change }) => [product, change]),
            userId,
            session,
        );
    }

    /**
     * Puts sold stock back, e.g. when a sale is voided or refunded: one
     * positive increment per product, through the same path as adjust().
     * Rejects with 404 if a product no longer has an inventory row.
     * `userId` is whoever reversed the sale: the row's `updatedBy`.
     */
    async returnStock(
        userId: string,
        lines: { product: { toString(): string }; quantity: number }[],
        session: ClientSession,
    ): Promise<void> {
        await this.applyChanges(
            lines.map(({ product, quantity }) => [product, quantity]),
            userId,
            session,
        );
    }

    private async applyChanges(
        entries: [product: { toString(): string }, change: number][],
        userId: string,
        session: ClientSession,
    ): Promise<void> {
        const updatedBy = new Types.ObjectId(userId);
        const netByProduct = sumByProduct(entries);

        // Read before writing: bulkWrite is ordered, so a read afterwards
        // would see stock already changed by earlier ops in this request.
        const stockByProduct = await this.getStockByProduct(
            [...netByProduct.keys()],
            session,
        );

        const missing = [...netByProduct.keys()].filter(
            (product) => !stockByProduct.has(product),
        );
        if (missing.length > 0) {
            throw new NotFoundError(
                ErrorCode.PRODUCT_NOT_FOUND,
                'One or more products have no inventory record',
                missing.map((product) => ({ product })),
            );
        }

        // One op per product with a non-zero net change. Lines that cancel
        // out (e.g. +3 and -3) leave stock unchanged and need no write.
        const updates = [...netByProduct]
            .filter(([, change]) => change !== 0)
            .map(([product, change]) => ({
                updateOne: {
                    // Same guard as sell(): Mongoose's `min` validator does not
                    // run on update operators, so a negative $inc must be
                    // guarded in the filter or it will drive stock below zero.
                    filter:
                        change < 0
                            ? { product, stock: { $gte: -change } }
                            : { product },
                    update: { $inc: { stock: change }, $set: { updatedBy } },
                },
            }));

        if (updates.length === 0) return;

        const result = await this.model.bulkWrite(updates, { session });

        if (result.matchedCount !== updates.length) {
            const shortfalls = [...netByProduct]
                .map(([product, change]) => {
                    const current = stockByProduct.get(product);
                    return {
                        product,
                        name: current?.name,
                        change,
                        available: current?.stock ?? 0,
                    };
                })
                .filter((item) => item.available + item.change < 0);

            throw new ValidationError(
                ErrorCode.VALIDATION_INVALID_INPUT,
                'Adjustment would make stock negative for one or more products',
                shortfalls,
            );
        }
    }

    /**
     * Sells stock. Quantities are summed per product so each product gets a
     * single guarded decrement, and shortfalls are reported against stock
     * read before the write (see adjust() for why). `userId` is the
     * cashier: the row's `updatedBy`.
     */
    async sell(
        userId: string,
        dto: SellDto,
        session: ClientSession,
    ): Promise<void> {
        const updatedBy = new Types.ObjectId(userId);
        const quantityByProduct = sumByProduct(
            dto.sellDetails.map(({ product, quantity }) => [product, quantity]),
        );

        const stockByProduct = await this.getStockByProduct(
            [...quantityByProduct.keys()],
            session,
        );

        const updates = [...quantityByProduct].map(([product, quantity]) => ({
            updateOne: {
                // The $gte guard belongs in the filter: Mongoose's `min` validator
                // does not run on update operators, so an unguarded $inc will
                // happily drive stock negative when a sale oversells.
                filter: { product, stock: { $gte: quantity } },
                update: { $inc: { stock: -quantity }, $set: { updatedBy } },
            },
        }));

        const result = await this.model.bulkWrite(updates, { session });

        if (result.matchedCount !== updates.length) {
            const shortfalls = [...quantityByProduct]
                .map(([product, quantity]) => {
                    const current = stockByProduct.get(product);
                    return {
                        product,
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
    }

    /**
     * Reads current stock for the given products inside the session, keyed
     * by product id. Rows whose product no longer exists are left out.
     */
    private async getStockByProduct(
        products: string[],
        session: ClientSession,
    ): Promise<Map<string, { name: string; stock: number }>> {
        const rows = await this.model
            .find({ product: { $in: products } })
            .populate<{ product: { _id: Types.ObjectId; name: string } }>({
                path: 'product',
                select: 'name',
            })
            .session(session)
            .lean();

        return new Map(
            rows
                .filter((row) => row.product?._id)
                .map((row) => [
                    row.product._id.toString(),
                    { name: row.product.name, stock: row.stock },
                ]),
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

/** Sums amounts per product id, preserving first-seen order. */
function sumByProduct(
    entries: [product: { toString(): string }, amount: number][],
): Map<string, number> {
    const totals = new Map<string, number>();
    for (const [product, amount] of entries) {
        const key = product.toString();
        totals.set(key, (totals.get(key) ?? 0) + amount);
    }
    return totals;
}
