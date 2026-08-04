import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Adjustment } from './adjustment.schema';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AdjustmentDetails } from './adjustment-details.schema';
import { AdjustDto, GetAllDto, GetDetailsDto } from './types';
import { InventoryService } from '../inventory/inventory.service';
import { runInTransaction } from '../../common/utils/db';
import { AuthUser } from '../../auth/types';
import { User } from '../../user/user.schema';

@Injectable()
export class AdjustmentService {
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(Adjustment.name) private model: Model<Adjustment>,
        @InjectModel(AdjustmentDetails.name)
        private modelDetails: Model<AdjustmentDetails>,
        private inventoryService: InventoryService,
    ) {}

    async getAll(
        dto: GetAllDto,
    ): Promise<{ data: Adjustment[]; totalItems: number }> {
        const { page, limit, dateRange, adjustedBy } = dto;

        const skip = (page - 1) * limit;

        const query: Record<string, unknown> = {};
        if (adjustedBy) {
            query.adjustedBy = new Types.ObjectId(adjustedBy);
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
                    path: 'adjustedBy',
                    select: 'name',
                })
                .lean(),

            query?.adjustedBy || query?.createdAt
                ? this.model.countDocuments(query)
                : this.model.estimatedDocumentCount(),
        ]);

        return {
            data,
            totalItems,
        };
    }

    async adjust(
        user: AuthUser,
        dto: AdjustDto,
        session?: ClientSession,
    ): Promise<void> {
        const { description, adjustDetails } = dto;

        await runInTransaction(
            async (session) => {
                const [adjustment] = await this.model.create(
                    [
                        {
                            description,
                            adjustedBy: user.userId,
                        },
                    ],
                    { session },
                );

                const inserts = adjustDetails.map((detail) => ({
                    insertOne: {
                        document: {
                            adjustment: adjustment._id,
                            ...detail,
                        },
                    },
                }));

                await this.modelDetails.bulkWrite(inserts, { session });
                await this.inventoryService.adjust(dto, session);
            },
            this.connection,
            session,
        );
    }

    async getDetails(
        dto: GetDetailsDto,
    ): Promise<{ data: Adjustment[]; totalItems: number }> {
        const { page, limit, EAN, name, adjustment } = dto;

        const skip = (page - 1) * limit;

        const adjustmentQuery = {
            adjustment: new Types.ObjectId(adjustment),
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

        Logger.log({ adjustmentQuery, productQuery });

        const result = await this.modelDetails.aggregate<{
            paginatedData: Adjustment[];
            metadata: Array<{ total: number }>;
        }>([
            { $match: adjustmentQuery },
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

    async getAdjustUsers(): Promise<User[]> {
        return await this.model.aggregate([
            { $group: { _id: '$adjustedBy' } },
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
