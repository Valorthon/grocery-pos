import { InventoryBatchController } from './batch.controller';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InventoryBatch, InventoryBatchSchema } from './batch.schema';
import { InventoryBatchService } from './batch.service';
import { Product, ProductSchema } from '../../product/product.schema';
import { Inventory, InventorySchema } from '../inventory/inventory.schema';
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: InventoryBatch.name, schema: InventoryBatchSchema },
            { name: Product.name, schema: ProductSchema },
            { name: Inventory.name, schema: InventorySchema },
        ]),
    ],
    controllers: [InventoryBatchController],
    providers: [InventoryBatchService],
    exports: [InventoryBatchService],
})
export class InventoryBatchModule {}
