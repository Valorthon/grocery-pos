import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PurchaseOrder, PurchaseOrderSchema } from './purchase-order.schema';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderService } from './purchase-order.service';
import { SupplierModule } from '../supplier/supplier.module';
import { RestockModule } from '../inventory-man/restock/restock.module';
import { Supplier, SupplierSchema } from '../supplier/supplier.schema';
import { Product, ProductSchema } from '../product/product.schema';
import { User, UserSchema } from '../user/user.schema';

@Module({
    imports: [
        SupplierModule,
        RestockModule,
        MongooseModule.forFeature([
            { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
            { name: Supplier.name, schema: SupplierSchema },
            { name: Product.name, schema: ProductSchema },
            { name: User.name, schema: UserSchema },
        ]),
    ],
    controllers: [PurchaseOrderController],
    providers: [PurchaseOrderService],
})
export class PurchaseOrderModule {}
