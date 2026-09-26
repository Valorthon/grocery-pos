import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import {
    COUNTED_SALES_FILTER,
    Sales,
    type SaleRowDoc,
} from '../sales/sales.schema';
import { Inventory } from '../inventory-man/inventory/inventory.schema';
import { Product } from '../product/product.schema';
import {
    Restock,
    type RestockRowDoc,
} from '../inventory-man/restock/restock.schema';
import {
    Adjustment,
    type AdjustmentRowDoc,
} from '../inventory-man/adjustment/adjustment.schema';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { calendarDateInZone, dayRangeInZone } from '../common/utils/timezone';
import { LOW_STOCK_THRESHOLD } from '../constants';
import type { NameRef } from '../common/wire';

/**
 * A restock in the activity feed: for a non-admin only
 * `RESTOCK_ACTIVITY_FIELDS`, for an ADMIN the whole row.
 */
export type RestockActivityDoc = Pick<
    RestockRowDoc,
    '_id' | 'description' | 'restockedBy' | 'createdAt'
> &
    Partial<Pick<RestockRowDoc, 'totalCost' | 'updatedAt'>>;

/** What every dashboard role sees: stock and activity, no money. */
export interface DashboardStats {
    totalProducts: number;
    /** Products with 1 to LOW_STOCK_THRESHOLD units on hand. */
    lowStockCount: number;
    /** Products with 0 (or fewer) units on hand. */
    outOfStockCount: number;
    /** Store-wide count of today's sales that were not reversed. */
    todaySalesCount: number;
    /** Newest restocks; without `totalCost` unless the caller is ADMIN. */
    recentRestocks: RestockActivityDoc[];
    recentAdjustments: AdjustmentRowDoc[];
}

/** The money figures only ADMIN receives (issue #13). */
export interface DashboardMoney {
    /** Centavos. */
    todayRevenue: number;
    /** The newest sales store-wide, with their amounts and cashiers. */
    recentSales: SaleRowDoc[];
}

export type DashboardResponse = DashboardStats & Partial<DashboardMoney>;

export interface DashboardOptions {
    /** Whether to include money figures: true for ADMIN only. */
    includeMoney: boolean;
}

/**
 * Restock fields a non-admin dashboard may see. A whitelist, so a money
 * field added to Restock later stays out by default.
 */
export const RESTOCK_ACTIVITY_FIELDS = '_id description restockedBy createdAt';

/**
 * Counts the dashboard's stock tiles in one pass over the inventory rows at
 * or below the threshold (product owner, 2026-09-25): low stock is
 * `1 <= stock <= LOW_STOCK_THRESHOLD`, out of stock is `stock <= 0`.
 *
 * Orphan rows (their product gone) count toward neither: the inner
 * `$unwind` drops them, as `inventoryListPipeline` does (issue #14). So the
 * out-of-stock tile matches the inventory list at `maxStock=0`, and the two
 * tiles together match `maxStock=LOW_STOCK_THRESHOLD` (0..10); the low tile
 * alone is 1..10. Exported so specs can pin its shape; its behaviour needs
 * a real MongoDB.
 */
export function stockAlertPipeline(): PipelineStage[] {
    return [
        { $match: { stock: { $lte: LOW_STOCK_THRESHOLD } } },
        {
            $lookup: {
                from: 'products',
                localField: 'product',
                foreignField: '_id',
                pipeline: [{ $project: { _id: 1 } }],
                as: 'product',
            },
        },
        { $unwind: '$product' },
        {
            $group: {
                _id: null,
                lowStockCount: {
                    $sum: { $cond: [{ $gte: ['$stock', 1] }, 1, 0] },
                },
                outOfStockCount: {
                    $sum: { $cond: [{ $lte: ['$stock', 0] }, 1, 0] },
                },
            },
        },
    ];
}

@Injectable()
export class DashboardService {
    constructor(
        @InjectModel(Sales.name) private salesModel: Model<Sales>,
        @InjectModel(Inventory.name) private inventoryModel: Model<Inventory>,
        @InjectModel(Product.name) private productModel: Model<Product>,
        @InjectModel(Restock.name) private restockModel: Model<Restock>,
        @InjectModel(Adjustment.name)
        private adjustmentModel: Model<Adjustment>,
        private config: TypedConfigService,
    ) {}

    /**
     * The dashboard figures. Without `includeMoney` nothing in centavos is
     * read or returned: no revenue sum, no recent-sales feed (a sale is a
     * money record, and other cashiers' sales are not a non-admin's to
     * browse; see SalesService.getAll), and restocks without `totalCost`.
     */
    async getDashboard({
        includeMoney,
    }: DashboardOptions): Promise<DashboardResponse> {
        const timeZone = this.config.get('STORE_TIMEZONE');
        const { start: startOfDay, end: endOfDay } = dayRangeInZone(
            calendarDateInZone(new Date(), timeZone),
            timeZone,
        );

        const restocks = this.restockModel
            .find()
            .sort({ createdAt: -1 })
            .limit(5);
        if (!includeMoney) restocks.select(RESTOCK_ACTIVITY_FIELDS);

        const [
            totalProducts,
            stockAlertAgg,
            todaySalesAgg,
            recentSales,
            recentRestocks,
            recentAdjustments,
        ] = await Promise.all([
            // Exact: a user-facing figure (issue #16).
            this.productModel.countDocuments(),
            this.inventoryModel.aggregate<{
                lowStockCount: number;
                outOfStockCount: number;
            }>(stockAlertPipeline()),
            this.salesModel.aggregate<{ count: number; revenue?: number }>([
                {
                    $match: {
                        createdAt: { $gte: startOfDay, $lt: endOfDay },
                        // Voided and refunded sales are not revenue.
                        ...COUNTED_SALES_FILTER,
                    },
                },
                {
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                        ...(includeMoney && { revenue: { $sum: '$amount' } }),
                    },
                },
            ]),
            includeMoney
                ? this.salesModel
                      .find()
                      .sort({ createdAt: -1 })
                      .limit(5)
                      .populate<{ cashier: NameRef | null }>({
                          path: 'cashier',
                          select: 'name',
                      })
                      .lean<SaleRowDoc[]>()
                : Promise.resolve(null),
            restocks
                .populate<{ restockedBy: NameRef | null }>({
                    path: 'restockedBy',
                    select: 'name',
                })
                .lean<RestockActivityDoc[]>(),
            this.adjustmentModel
                .find()
                .sort({ createdAt: -1 })
                .limit(5)
                .populate<{ adjustedBy: NameRef | null }>({
                    path: 'adjustedBy',
                    select: 'name',
                })
                .lean<AdjustmentRowDoc[]>(),
        ]);

        const todaySales = todaySalesAgg[0];
        const stockAlerts = stockAlertAgg[0];

        const stats: DashboardStats = {
            totalProducts,
            lowStockCount: stockAlerts?.lowStockCount ?? 0,
            outOfStockCount: stockAlerts?.outOfStockCount ?? 0,
            todaySalesCount: todaySales?.count ?? 0,
            recentRestocks,
            recentAdjustments,
        };

        if (!includeMoney) return stats;

        return {
            ...stats,
            todayRevenue: todaySales?.revenue ?? 0,
            recentSales: recentSales ?? [],
        };
    }
}
