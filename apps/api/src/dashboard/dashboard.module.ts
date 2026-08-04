import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Sales, SalesSchema } from '../sales/sales.schema';
import {
    Inventory,
    InventorySchema,
} from '../inventory-man/inventory/inventory.schema';
import { Product, ProductSchema } from '../product/product.schema';
import {
    Restock,
    RestockSchema,
} from '../inventory-man/restock/restock.schema';
import {
    Adjustment,
    AdjustmentSchema,
} from '../inventory-man/adjustment/adjustment.schema';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Sales.name, schema: SalesSchema },
            { name: Inventory.name, schema: InventorySchema },
            { name: Product.name, schema: ProductSchema },
            { name: Restock.name, schema: RestockSchema },
            { name: Adjustment.name, schema: AdjustmentSchema },
        ]),
    ],
    providers: [DashboardService],
    controllers: [DashboardController],
})
export class DashboardModule {}
