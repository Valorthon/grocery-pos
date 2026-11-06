import { SettingsService } from '../../settings/settings.service';
import {
    Inject as InjectSettings,
    Optional as OptionalSettings,
} from '@nestjs/common';
import { StockMovementType, StockMovementSource } from '@grocery-pos/contracts';
import { InventoryBatchService } from '../batch/batch.service';
import { Optional } from '@nestjs/common';
import { SupplierService } from '../../supplier/supplier.service';
import { ValidationError, ErrorCode } from '../../common/errors';
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Restock, type RestockRowDoc } from './restock.schema';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { RestockDetails, type RestockLineDoc } from './restock-details.schema';
import {
    quantityAmount,
    maxQuantityForAmount,
    NUMERIC_LIMITS,
    type Paginated,
} from '@grocery-pos/contracts';
import type { NameRef } from '../../common/wire';
import { GetAllDto, GetDetailsDto, RestockDto } from './types';
import { InventoryService } from '../inventory/inventory.service';
import { runInTransaction } from '../../common/utils/db';
import { productSearchFilter } from '../../product/product-search';
import { dateRangeFilter } from '../../common/utils/timezone';
import { TypedConfigService } from '../../common/typed-config/typed-config.service';
import { AuthUser } from '../../auth/types';
import { ProductService } from '../../product/product.service';
/** One entry of the `GET .../users` filter list: nothing beyond the name. */
export type UserOption = NameRef;
export interface RestockOptions {
    /** Links the receipt to this PO; its supplier need not be active. */
    purchaseOrder?: Types.ObjectId;
}

@Injectable()
export class RestockService {
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(Restock.name) private model: Model<Restock>,
        @InjectModel(RestockDetails.name)
        private modelDetails: Model<RestockDetails>,
        private inventoryService: InventoryService,
        private config: TypedConfigService,
        private productService: ProductService,
        private suppliers: SupplierService,
        @Optional() private batches?: InventoryBatchService,
        @OptionalSettings()
        @InjectSettings(SettingsService)
        private settings?: SettingsService,
    ) {}

    async restock(
        user: AuthUser,
        dto: RestockDto,
        session?: ClientSession,
        options: RestockOptions = {},
    ): Promise<Types.ObjectId> {
        const { description, restockDetails } = dto;

        return runInTransaction(
            async (session) => {
                // An open PO of a since-archived supplier stays receivable (#123).
                if (options.purchaseOrder)
                    await this.suppliers.assertExists(dto.supplier, session);
                else await this.suppliers.assertActive(dto.supplier, session);
                const updatedRestockDetails =
                    await this.inventoryService.restock(user, dto, session);

                const totalCost = restockDetails.reduce(
                    (sum, detail, index) => {
                        const unit = updatedRestockDetails[index]?.unit;
                        if (
                            detail.unitCost &&
                            detail.quantity >
                                maxQuantityForAmount(
                                    NUMERIC_LIMITS.AMOUNT_MAX - sum,
                                    detail.unitCost,
                                    unit,
                                )
                        )
                            throw new ValidationError(
                                ErrorCode.VALIDATION_INVALID_INPUT,
                                'Restock exceeds the maximum amount',
                            );
                        return (
                            sum +
                            quantityAmount(
                                detail.unitCost,
                                detail.quantity,
                                unit,
                            )
                        );
                    },
                    0,
                );
                const [created] = await this.model.create(
                    [
                        {
                            description,
                            supplier: new Types.ObjectId(dto.supplier),
                            ...(dto.invoiceNumber !== undefined && {
                                invoiceNumber: dto.invoiceNumber,
                            }),
                            ...(options.purchaseOrder && {
                                purchaseOrder: options.purchaseOrder,
                            }),
                            restockedBy: user.userId,
                            totalCost,
                        },
                    ],
                    { session },
                );

                const batchLines = updatedRestockDetails.map(
                    (detail, index) => ({
                        ...detail,
                        _id: new Types.ObjectId(),
                        ...(dto.restockDetails[index]?.expiryDate !==
                            undefined && {
                            expiryDate: dto.restockDetails[index].expiryDate,
                        }),
                        ...(dto.restockDetails[index]?.batchNo !==
                            undefined && {
                            batchNo: dto.restockDetails[index].batchNo,
                        }),
                    }),
                );
                const inserts = batchLines.map((detail) => ({
                    insertOne: {
                        document: {
                            restock: created._id,
                            ...detail,
                        },
                    },
                }));

                await this.modelDetails.bulkWrite(inserts, { session });
                await this.batches?.receive(batchLines, session);
                await this.productService.recordReceiptCosts(
                    updatedRestockDetails,
                    session,
                );
                await this.inventoryService.recordMovements(
                    updatedRestockDetails.map((line) => ({
                        product: line.product.toString(),
                        quantity: line.quantity,
                    })),
                    {
                        type: StockMovementType.RESTOCK,
                        refModel: StockMovementSource.RESTOCK,
                        refId: String(created._id),
                        user: user.userId,
                    },
                    session,
                );
                return created._id;
            },
            this.connection,
            session,
        );
    }

    async getAll(dto: GetAllDto): Promise<Paginated<RestockRowDoc>> {
        const { page, limit, dateFrom, dateTo, restockedBy } = dto;

        const skip = (page - 1) * limit;

        const query: Record<string, unknown> = {};
        if (dto.source) query._id = new Types.ObjectId(dto.source);
        if (dto.purchaseOrder)
            query.purchaseOrder = new Types.ObjectId(dto.purchaseOrder);
        if (restockedBy) {
            query.restockedBy = new Types.ObjectId(restockedBy);
        }
        const createdAt = dateRangeFilter(
            dateFrom,
            dateTo,
            this.settings
                ? await this.settings.timezone()
                : this.config.get('STORE_TIMEZONE'),
        );
        if (createdAt) {
            query.createdAt = createdAt;
        }

        const [data, totalItems] = await Promise.all([
            this.model
                .find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate<{ restockedBy: NameRef | null }>({
                    path: 'restockedBy',
                    select: 'name',
                })
                .populate<{ supplier: NameRef | null }>({
                    path: 'supplier',
                    select: 'name',
                })
                .lean<RestockRowDoc[]>(),

            this.model.countDocuments(query),
        ]);

        return {
            data,
            totalItems,
        };
    }

    async getDetails(dto: GetDetailsDto): Promise<Paginated<RestockLineDoc>> {
        const { page, limit, EAN, name, restock } = dto;

        const skip = (page - 1) * limit;

        const restockQuery = {
            restock: new Types.ObjectId(restock),
        };

        const productQuery = productSearchFilter({ name, EAN }, 'product.');

        const result = await this.modelDetails.aggregate<{
            paginatedData: RestockLineDoc[];
            metadata: Array<{ total: number }>;
        }>([
            { $match: restockQuery },
            {
                $lookup: {
                    from: 'products',
                    pipeline: [
                        {
                            $project: {
                                saleVersion: 0,
                                priceHistory: 0,
                                lastCost: 0,
                                costUpdatedAt: 0,
                            },
                        },
                    ],
                    localField: 'product',
                    foreignField: '_id',
                    as: 'product',
                },
            },
            { $unwind: '$product' },
            { $match: productQuery },
            {
                $facet: {
                    metadata: [{ $count: 'total' }],
                    paginatedData: [
                        { $sort: { 'product.name': 1, _id: 1 } },
                        { $skip: skip },
                        { $limit: limit },
                    ],
                },
            },
        ]);

        const data = result[0]?.paginatedData ?? [];
        const totalItems = result[0]?.metadata[0]?.total ?? 0;

        return { data, totalItems };
    }

    async getRestockUsers(): Promise<UserOption[]> {
        return await this.model.aggregate<UserOption>([
            { $group: { _id: '$restockedBy' } },
            {
                // Only the name ever leaves the users collection: never the
                // password hash, roles or status (issue #12).
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    pipeline: [{ $project: { name: 1 } }],
                    as: 'userDoc',
                },
            },
            { $unwind: '$userDoc' },
            {
                $project: {
                    _id: '$userDoc._id',
                    name: '$userDoc.name',
                },
            },
        ]);
    }
}
