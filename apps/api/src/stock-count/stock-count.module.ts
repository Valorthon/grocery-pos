import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StockCount, StockCountSchema } from './stock-count.schema';
import { StockCountService } from './stock-count.service';
import { StockCountController } from './stock-count.controller';
import { InventoryModule } from '../inventory-man/inventory/inventory.module';
import {
    Inventory,
    InventorySchema,
} from '../inventory-man/inventory/inventory.schema';
import {
    InventoryBatch,
    InventoryBatchSchema,
} from '../inventory-man/batch/batch.schema';
import {
    Adjustment,
    AdjustmentSchema,
} from '../inventory-man/adjustment/adjustment.schema';
import {
    AdjustmentDetails,
    AdjustmentDetailsSchema,
} from '../inventory-man/adjustment/adjustment-details.schema';
import { Product, ProductSchema } from '../product/product.schema';
import { User, UserSchema } from '../user/user.schema';
import { ManagerOverrideModule } from '../auth/override/override.module';
@Module({
    imports: [
        InventoryModule,
        ManagerOverrideModule,
        MongooseModule.forFeature([
            { name: StockCount.name, schema: StockCountSchema },
            { name: Product.name, schema: ProductSchema },
            { name: Inventory.name, schema: InventorySchema },
            { name: InventoryBatch.name, schema: InventoryBatchSchema },
            { name: Adjustment.name, schema: AdjustmentSchema },
            { name: AdjustmentDetails.name, schema: AdjustmentDetailsSchema },
            { name: User.name, schema: UserSchema },
        ]),
    ],
    providers: [StockCountService],
    controllers: [StockCountController],
})
export class StockCountModule {}
