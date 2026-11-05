import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Supplier, SupplierSchema } from './supplier.schema';
import { SupplierController } from './supplier.controller';
import { SupplierService } from './supplier.service';
import {
    Restock,
    RestockSchema,
} from '../inventory-man/restock/restock.schema';
import { Product, ProductSchema } from '../product/product.schema';
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Supplier.name, schema: SupplierSchema },
            { name: Restock.name, schema: RestockSchema },
            { name: Product.name, schema: ProductSchema },
        ]),
    ],
    controllers: [SupplierController],
    providers: [SupplierService],
    exports: [SupplierService],
})
export class SupplierModule {}
