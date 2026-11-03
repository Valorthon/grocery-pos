import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../user/user.schema';
import { Sales, SalesSchema } from '../../sales/sales.schema';
import { Shift, ShiftSchema } from '../../shift/shift.schema';
import { ProductModule } from '../../product/product.module';
import { RateLimitModule } from '../rate-limit/rate-limit';
import { OverrideGrant, OverrideGrantSchema } from './override-grant.schema';
import {
    ManagerOverrideController,
    OverridePinController,
} from './override.controller';
import { ManagerOverrideService } from './override.service';

@Module({
    imports: [
        JwtModule.register({}),
        RateLimitModule,
        ProductModule,
        MongooseModule.forFeature([
            { name: User.name, schema: UserSchema },
            { name: Sales.name, schema: SalesSchema },
            { name: Shift.name, schema: ShiftSchema },
            { name: OverrideGrant.name, schema: OverrideGrantSchema },
        ]),
    ],
    providers: [ManagerOverrideService],
    controllers: [ManagerOverrideController, OverridePinController],
    exports: [ManagerOverrideService],
})
export class ManagerOverrideModule {}
