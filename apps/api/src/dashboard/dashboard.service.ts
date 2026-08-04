import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Sales } from '../sales/sales.schema';
import { Inventory } from '../inventory-man/inventory/inventory.schema';
import { Product } from '../product/product.schema';
import { Restock } from '../inventory-man/restock/restock.schema';
import { Adjustment } from '../inventory-man/adjustment/adjustment.schema';

export interface DashboardResponse {
    totalProducts: number;
    lowStockCount: number;
    todaySalesCount: number;
    todayRevenue: number;
    recentSales: Array<Record<string, unknown>>;
    recentRestocks: Array<Record<string, unknown>>;
    recentAdjustments: Array<Record<string, unknown>>;
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
    ) {}

    async getDashboard(): Promise<DashboardResponse> {
        const now = new Date();
        const startOfDay = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
        );
        const endOfDay = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + 1,
        );

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
            this.salesModel.aggregate<{
                count: number;
                revenue: number;
            }>([
                {
                    $match: {
                        createdAt: { $gte: startOfDay, $lt: endOfDay },
                    },
                },
                {
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                        revenue: { $sum: '$amount' },
                    },
                },
            ]),
            this.salesModel
                .find()
                .sort({ createdAt: -1 })
                .limit(5)
                .populate({ path: 'cashier', select: 'name' })
                .lean(),
            this.restockModel
                .find()
                .sort({ createdAt: -1 })
                .limit(5)
                .populate({ path: 'restockedBy', select: 'name' })
                .lean(),
            this.adjustmentModel
                .find()
                .sort({ createdAt: -1 })
                .limit(5)
                .populate({ path: 'adjustedBy', select: 'name' })
                .lean(),
        ]);

        const todaySales = todaySalesAgg[0] ?? { count: 0, revenue: 0 };

        return {
            totalProducts,
            lowStockCount,
            todaySalesCount: todaySales.count,
            todayRevenue: todaySales.revenue,
            recentSales,
            recentRestocks,
            recentAdjustments,
        };
    }
}
