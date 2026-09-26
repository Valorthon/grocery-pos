import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Restock, type RestockRowDoc } from './restock.schema';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { RestockDetails, type RestockLineDoc } from './restock-details.schema';
import type { Paginated } from '@grocery-pos/contracts';
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
    ) {}

    async restock(
        user: AuthUser,
        dto: RestockDto,
        session?: ClientSession,
    ): Promise<void> {
        const { description, restockDetails } = dto;

        // unitCost is integer centavos, so the total is exact.
        const totalCost = restockDetails.reduce((sum, detail) => {
            return sum + detail.quantity * detail.unitCost;
        }, 0);

        await runInTransaction(
            async (session) => {
                const updatedRestockDetails =
                    await this.inventoryService.restock(user, dto, session);

                const [created] = await this.model.create(
                    [
                        {
                            description,
                            restockedBy: user.userId,
                            totalCost,
                        },
                    ],
                    { session },
                );

                const inserts = updatedRestockDetails.map((detail) => ({
                    insertOne: {
                        document: {
                            restock: created._id,
                            ...detail,
                        },
                    },
                }));

                await this.modelDetails.bulkWrite(inserts, { session });
            },
            this.connection,
            session,
        );
    }

    async getAll(dto: GetAllDto): Promise<Paginated<RestockRowDoc>> {
        const { page, limit, dateFrom, dateTo, restockedBy } = dto;

        const skip = (page - 1) * limit;

        const query: Record<string, unknown> = {};
        if (restockedBy) {
            query.restockedBy = new Types.ObjectId(restockedBy);
        }
        const createdAt = dateRangeFilter(
            dateFrom,
            dateTo,
            this.config.get('STORE_TIMEZONE'),
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
