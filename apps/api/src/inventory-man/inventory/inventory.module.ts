import { StockMovementModule } from '../../stock-movement/stock-movement.module';
import { InventoryBatchModule } from '../batch/batch.module';
import { forwardRef, Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Inventory, InventorySchema } from './inventory.schema';
import { ProductModule } from '../../product/product.module';

@Module({
    imports: [
        InventoryBatchModule,
        StockMovementModule,
        MongooseModule.forFeature([
            {
                name: Inventory.name,
                schema: InventorySchema,
            },
        ]),
        forwardRef(() => ProductModule),
    ],
    providers: [InventoryService],
    controllers: [InventoryController],
    exports: [InventoryService],
})
export class InventoryModule {}
