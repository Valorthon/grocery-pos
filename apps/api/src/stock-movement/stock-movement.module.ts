import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StockMovement, StockMovementSchema } from './stock-movement.schema';
import { StockMovementService } from './stock-movement.service';
import { StockMovementController } from './stock-movement.controller';
import {
    Inventory,
    InventorySchema,
} from '../inventory-man/inventory/inventory.schema';
import { Product, ProductSchema } from '../product/product.schema';
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: StockMovement.name, schema: StockMovementSchema },
            { name: Inventory.name, schema: InventorySchema },
            { name: Product.name, schema: ProductSchema },
        ]),
    ],
    providers: [StockMovementService],
    controllers: [StockMovementController],
    exports: [StockMovementService],
})
export class StockMovementModule {}
