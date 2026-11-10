import { SettingsService } from '../settings/settings.service';
import {
    Inject as InjectSettings,
    Optional as OptionalSettings,
} from '@nestjs/common';
import { InventoryBatchService } from '../inventory-man/batch/batch.service';
import { Optional } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { SETTINGS_LIMITS } from '@grocery-pos/contracts';
import {
    COUNTED_SALES_FILTER,
    INTERNAL_SALE_FIELDS,
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
import { reorderLevelExpression } from '../inventory-man/inventory/reorder-query';
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
    /** Active products (`isActive != false`), #213. */
    totalProducts: number;
    /** Lots of active products in stock, expiring within `expiryAlertDays` or expired. */
    expiringBatchCount?: number;
    expiryAlertDays?: number;
    /** Active products at or below their per-product reorder level, including zero/negative stock. */
    lowStockCount: number;
    /** Products with 0 (or fewer) units on hand. */
    outOfStockCount: number;
    /** Newest restocks; without `totalCost` unless the caller is ADMIN. */
    recentRestocks: RestockActivityDoc[];
    recentAdjustments: AdjustmentRowDoc[];
}

/** The money figures only ADMIN receives (issue #13). */
export interface DashboardMoney {
    /** Store-wide count of today's sales that were not reversed (#213). */
    todaySalesCount: number;
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

/** Alerts include zero/negative stock (owner #40); archived products and orphans are excluded. */
export function stockAlertPipeline(): PipelineStage[] {
    return [
        {
            $lookup: {
                from: 'products',
                localField: 'product',
                foreignField: '_id',
                pipeline: [
                    {
                        $project: {
                            _id: 1,
                            unit: 1,
                            isActive: 1,
                            reorderLevel: 1,
                        },
                    },
                ],
                as: 'product',
            },
        },
        { $unwind: '$product' },
        { $match: { 'product.isActive': { $ne: false } } },
        {
            $group: {
                _id: null,
                lowStockCount: {
                    $sum: {
                        $cond: [
                            { $lte: ['$stock', reorderLevelExpression()] },
                            1,
                            0,
                        ],
                    },
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
        @Optional() private batches?: InventoryBatchService,
        @OptionalSettings()
        @InjectSettings(SettingsService)
        private settings?: SettingsService,
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
        const settings = this.settings ? await this.settings.read() : null;
        const timeZone =
            settings?.timezone ?? this.config.get('STORE_TIMEZONE');
        const expiryAlertDays =
            settings?.expiryAlertDays ??
            SETTINGS_LIMITS.EXPIRY_ALERT_DAYS_DEFAULT;
        const { start: startOfDay, end: endOfDay } = dayRangeInZone(
            calendarDateInZone(new Date(), timeZone),
            timeZone,
        );

        const restocks = this.restockModel
            .find()
            .sort({ createdAt: -1 })
            .limit(5);
        restocks.select(
            RESTOCK_ACTIVITY_FIELDS +
                (includeMoney ? ' totalCost updatedAt' : ''),
        );

        const [
            totalProducts,
            stockAlertAgg,
            todaySalesAgg,
            recentSales,
            recentRestocks,
            recentAdjustments,
        ] = await Promise.all([
            // Exact: a user-facing figure (issue #16); active only (#213).
            this.productModel.countDocuments({ isActive: { $ne: false } }),
            this.inventoryModel.aggregate<{
                lowStockCount: number;
                outOfStockCount: number;
            }>(stockAlertPipeline()),
            // Today's sales are ADMIN-only (#213): not even read otherwise.
            includeMoney
                ? this.salesModel.aggregate<{ count: number; revenue: number }>(
                      [
                          {
                              $match: {
                                  $or: [
                                      {
                                          soldAt: {
                                              $gte: startOfDay,
                                              $lt: endOfDay,
                                          },
                                      },
                                      {
                                          soldAt: { $exists: false },
                                          createdAt: {
                                              $gte: startOfDay,
                                              $lt: endOfDay,
                                          },
                                      },
                                  ],
                                  // Voided and refunded sales are not revenue.
                                  ...COUNTED_SALES_FILTER,
                              },
                          },
                          {
                              $group: {
                                  _id: null,
                                  count: { $sum: 1 },
                                  revenue: { $sum: '$amount' },
                              },
                          },
                      ],
                  )
                : Promise.resolve([]),
            includeMoney
                ? this.salesModel
                      .find({}, INTERNAL_SALE_FIELDS)
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
            ...(this.batches && {
                expiringBatchCount:
                    await this.batches.expiringCount(expiryAlertDays),
                expiryAlertDays,
            }),
            lowStockCount: stockAlerts?.lowStockCount ?? 0,
            outOfStockCount: stockAlerts?.outOfStockCount ?? 0,
            recentRestocks,
            recentAdjustments,
        };

        if (!includeMoney) return stats;

        return {
            ...stats,
            todaySalesCount: todaySales?.count ?? 0,
            todayRevenue: todaySales?.revenue ?? 0,
            recentSales: recentSales ?? [],
        };
    }
}
