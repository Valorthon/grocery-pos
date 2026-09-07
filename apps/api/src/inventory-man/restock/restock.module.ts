import { Module } from '@nestjs/common';
import { RestockService } from './restock.service';
import { RestockController } from './restock.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Restock, RestockSchema } from './restock.schema';
import { RestockDetails, RestockDetailsSchema } from './restock-details.schema';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductModule } from '../../product/product.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            {
                name: Restock.name,
                schema: RestockSchema,
            },
            {
                name: RestockDetails.name,
                schema: RestockDetailsSchema,
            },
        ]),
        InventoryModule,
        ProductModule,
    ],
    providers: [RestockService],
    controllers: [RestockController],
})
export class RestockModule {}
