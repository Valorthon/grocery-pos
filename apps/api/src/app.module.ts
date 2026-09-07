import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypedConfigModule } from './common/typed-config/typed-config.module';
import { CookieModule } from './common/utils/cookie/cookie.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JWTAuthGuard } from './auth/guards/jwt.guard';
import { RoleGuard } from './auth/guards/role.guard';
import { RefreshTokenModule } from './auth/refresh-token/refresh-token.module';
import { GlobalFilter } from './common/global/global.filter';
import { ProductModule } from './product/product.module';
import { InventoryModule } from './inventory-man/inventory/inventory.module';
import { RestockModule } from './inventory-man/restock/restock.module';
import { AdjustmentModule } from './inventory-man/adjustment/adjustment.module';
import { SalesModule } from './sales/sales.module';
import { EanCounterModule } from './ean-counter/ean-counter.module';
import { TypedConfigService } from './common/typed-config/typed-config.service';
import { TimingMiddleware } from './common/middleware/timing.middleware';
import { HealthModule } from './health/health.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
    imports: [
        TypedConfigModule,
        MongooseModule.forRootAsync({
            imports: [TypedConfigModule],
            inject: [TypedConfigService],
            useFactory: (config: TypedConfigService) => ({
                uri: config.get('DATABASE_URL'),
            }),
        }),
        CookieModule,
        AuthModule,
        RefreshTokenModule,
        UserModule,
        ProductModule,
        InventoryModule,
        RestockModule,
        AdjustmentModule,
        SalesModule,
        EanCounterModule,
        HealthModule,
        DashboardModule,
    ],
    controllers: [],
    providers: [
        {
            provide: APP_GUARD,
            useClass: JWTAuthGuard,
        },
        {
            provide: APP_GUARD,
            useClass: RoleGuard,
        },
        {
            provide: APP_FILTER,
            useClass: GlobalFilter,
        },
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(TimingMiddleware).forRoutes('*');
    }
}
