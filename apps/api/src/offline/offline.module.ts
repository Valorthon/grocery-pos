import { OfflineCost, OfflineCostSchema } from './offline-cost.schema';
import { InventoryBatchModule } from '../inventory-man/batch/batch.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { OfflineController } from './offline.controller';
import { OfflineService } from './offline.service';
import { OfflineLease, OfflineLeaseSchema } from './offline-lease.schema';
import { Product, ProductSchema } from '../product/product.schema';
import { User, UserSchema } from '../user/user.schema';
import { Shift, ShiftSchema } from '../shift/shift.schema';
import {
    Inventory,
    InventorySchema,
} from '../inventory-man/inventory/inventory.schema';
import {
    RefreshToken,
    RefreshTokenSchema,
} from '../auth/refresh-token/refresh-token.schema';
import { Sales, SalesSchema } from '../sales/sales.schema';
import {
    SalesDetails,
    SalesDetailsSchema,
} from '../sales/sales-details.schema';
import { SalesModule } from '../sales/sales.module';
@Module({
    imports: [
        InventoryBatchModule,
        JwtModule.register({}),
        SalesModule,
        MongooseModule.forFeature([
            { name: OfflineLease.name, schema: OfflineLeaseSchema },
            { name: OfflineCost.name, schema: OfflineCostSchema },
            { name: Product.name, schema: ProductSchema },
            { name: User.name, schema: UserSchema },
            { name: Shift.name, schema: ShiftSchema },
            { name: Inventory.name, schema: InventorySchema },
            { name: RefreshToken.name, schema: RefreshTokenSchema },
            { name: Sales.name, schema: SalesSchema },
            { name: SalesDetails.name, schema: SalesDetailsSchema },
        ]),
    ],
    providers: [OfflineService],
    controllers: [OfflineController],
})
export class OfflineModule {}
