import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Restock } from './restock.schema';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { RestockDetails } from './restock-details.schema';
import { GetAllDto, GetDetailsDto, RestockDto } from './types';
import { InventoryService } from '../inventory/inventory.service';
import { runInTransaction } from '../../common/utils/db';
import { AuthUser } from '../../auth/types';
import { ProductService } from '../../product/product.service';
import { User } from '../../user/user.schema';

@Injectable()
export class RestockService {
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(Restock.name) private model: Model<Restock>,
        @InjectModel(RestockDetails.name)
        private modelDetails: Model<RestockDetails>,
        private inventoryService: InventoryService,
        private productService: ProductService,
    ) {}

    async restock(
        user: AuthUser,
        dto: RestockDto,
        session?: ClientSession,
    ): Promise<void> {
        const { description, restockDetails } = dto;

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

    async getAll(
        dto: GetAllDto,
    ): Promise<{ data: Restock[]; totalItems: number }> {
        const { page, limit, dateRange, restockedBy } = dto;

        const skip = (page - 1) * limit;

        const query: Record<string, unknown> = {};
        if (restockedBy) {
            query.restockedBy = new Types.ObjectId(restockedBy);
        }
        if (dateRange) {
            const start = dateRange[0];
            const end = dateRange[1] ?? new Date(start);

            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);

            query.createdAt = {
                $gte: start,
                $lte: end,
            };
        }

        Logger.log({ query, dto });

        const [data, totalItems] = await Promise.all([
            this.model
                .find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate({
                    path: 'restockedBy',
                    select: 'name',
                })
                .lean(),

            this.model.countDocuments(query),
        ]);

        return {
            data,
            totalItems,
        };
    }

    async getDetails(
        dto: GetDetailsDto,
    ): Promise<{ data: RestockDetails[]; totalItems: number }> {
        const { page, limit, EAN, name, restock } = dto;

        const skip = (page - 1) * limit;

        const restockQuery = {
            restock: new Types.ObjectId(restock),
        };

        const productQuery: Record<string, unknown> = {};
        if (name) {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            productQuery['product.name'] = { $regex: escaped };
        }
        if (EAN) {
            const escaped = EAN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            productQuery['product.EAN'] = { $regex: `^${escaped}` };
        }

        Logger.log({ productQuery });

        const result = await this.modelDetails.aggregate<{
            paginatedData: RestockDetails[];
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

        Logger.log({ result });
        const data = result[0]?.paginatedData ?? [];
        const totalItems = result[0]?.metadata[0]?.total ?? 0;

        return { data, totalItems };
    }

    async getRestockUsers(): Promise<User[]> {
        return await this.model.aggregate([
            { $group: { _id: '$restockedBy' } },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
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
