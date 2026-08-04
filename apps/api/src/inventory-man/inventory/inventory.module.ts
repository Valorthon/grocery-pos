import { forwardRef, Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Inventory, InventorySchema } from './inventory.schema';
import { ProductModule } from '../../product/product.module';

@Module({
    imports: [
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
