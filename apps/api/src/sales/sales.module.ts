import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Sales, SalesSchema } from './sales.schema';
import { SalesDetails, SalesDetailsSchema } from './sales-details.schema';
import { ProductModule } from '../product/product.module';
import { InventoryModule } from '../inventory-man/inventory/inventory.module';
import { UserModule } from '../user/user.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            {
                name: Sales.name,
                schema: SalesSchema,
            },
        ]),
        MongooseModule.forFeature([
            {
                name: SalesDetails.name,
                schema: SalesDetailsSchema,
            },
        ]),
        ProductModule,
        InventoryModule,
        UserModule,
    ],
    providers: [SalesService],
    controllers: [SalesController],
})
export class SalesModule {}
