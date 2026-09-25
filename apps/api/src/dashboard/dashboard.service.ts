import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { COUNTED_SALES_FILTER, Sales } from '../sales/sales.schema';
import { Inventory } from '../inventory-man/inventory/inventory.schema';
import { Product } from '../product/product.schema';
import { Restock } from '../inventory-man/restock/restock.schema';
import { Adjustment } from '../inventory-man/adjustment/adjustment.schema';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { calendarDateInZone, dayRangeInZone } from '../common/utils/timezone';

/** What every dashboard role sees: stock and activity, no money. */
export interface DashboardStats {
    totalProducts: number;
    lowStockCount: number;
    /** Store-wide count of today's sales that were not reversed. */
    todaySalesCount: number;
    /** Newest restocks; without `totalCost` unless the caller is ADMIN. */
    recentRestocks: Array<Record<string, unknown>>;
    recentAdjustments: Array<Record<string, unknown>>;
}

/** The money figures only ADMIN receives (issue #13). */
export interface DashboardMoney {
    /** Centavos. */
    todayRevenue: number;
    /** The newest sales store-wide, with their amounts and cashiers. */
    recentSales: Array<Record<string, unknown>>;
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
            lowStockCount,
            todaySalesAgg,
            recentSales,
            recentRestocks,
            recentAdjustments,
        ] = await Promise.all([
            this.productModel.estimatedDocumentCount(),
            this.inventoryModel.countDocuments({ stock: { $lte: 10 } }),
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
                      .populate({ path: 'cashier', select: 'name' })
                      .lean()
                : Promise.resolve(null),
            restocks.populate({ path: 'restockedBy', select: 'name' }).lean(),
            this.adjustmentModel
                .find()
                .sort({ createdAt: -1 })
                .limit(5)
                .populate({ path: 'adjustedBy', select: 'name' })
                .lean(),
        ]);

        const todaySales = todaySalesAgg[0];

        const stats: DashboardStats = {
            totalProducts,
            lowStockCount,
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
