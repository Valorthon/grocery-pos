import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/types';
import { RequireOwnRole, Roles } from '../auth/auth.decorator';
import {
    Role,
    type OfflineCatalogPage,
    type OfflineLeaseView,
    type Receipt,
} from '@grocery-pos/contracts';
import { OfflineService } from './offline.service';
import {
    OfflineCatalogDto,
    OfflineLeaseDto,
    OfflineLeaseParamDto,
    OfflineSaleDto,
    ReconcileOfflineSaleDto,
} from './offline.dto';
import { asJson } from '../common/wire';
@RequireOwnRole(Role.Seller)
@Controller('offline')
export class OfflineController {
    constructor(private service: OfflineService) {}
    @Post('lease') async lease(
        @CurrentUser() user: AuthUser,
        @Body() dto: OfflineLeaseDto,
    ): Promise<OfflineLeaseView> {
        return this.service.lease(user, dto);
    }
    @Get('catalog') async catalog(
        @CurrentUser() user: AuthUser,
        @Query() dto: OfflineCatalogDto,
    ): Promise<OfflineCatalogPage> {
        return this.service.catalog(user, dto);
    }
    @Post('leases/:id/release') async release(
        @CurrentUser() user: AuthUser,
        @Param() { id }: OfflineLeaseParamDto,
        @Body() dto: OfflineLeaseDto,
    ): Promise<void> {
        return this.service.release(user, id, dto);
    }
    @Post('sync') async sync(
        @CurrentUser() user: AuthUser,
        @Body() dto: OfflineSaleDto,
    ): Promise<Receipt> {
        return asJson(await this.service.sync(user, dto));
    }
    @Roles(Role.Admin) @Post('reconcile') async reconcile(
        @CurrentUser() user: AuthUser,
        @Body() dto: ReconcileOfflineSaleDto,
    ): Promise<Receipt> {
        return asJson(await this.service.sync(user, dto, true));
    }
}
