import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    Query,
} from '@nestjs/common';
import type { Paginated, PurchaseOrderView } from '@grocery-pos/contracts';
import { Roles } from '../auth/auth.decorator';
import { CurrentUser, Role, type AuthUser } from '../auth/types';
import {
    CreatePurchaseOrderDto,
    PurchaseOrderIdDto,
    PurchaseOrderQueryDto,
    PurchaseOrderVersionDto,
    ReceivePurchaseOrderDto,
    UpdatePurchaseOrderDto,
} from './purchase-order.dto';
import { PurchaseOrderService } from './purchase-order.service';

/** RESTOCKER and ADMIN, like suppliers and receipt costs (#123); no PIN. */
@Roles(Role.Restocker)
@Controller('purchase-orders')
export class PurchaseOrderController {
    constructor(private service: PurchaseOrderService) {}
    @Get() list(
        @Query() dto: PurchaseOrderQueryDto,
    ): Promise<Paginated<PurchaseOrderView>> {
        return this.service.list(dto);
    }
    @Get(':id') get(
        @Param() { id }: PurchaseOrderIdDto,
    ): Promise<PurchaseOrderView> {
        return this.service.get(id);
    }
    @Post() create(
        @CurrentUser() actor: AuthUser,
        @Body() dto: CreatePurchaseOrderDto,
    ): Promise<PurchaseOrderView> {
        return this.service.create(actor, dto);
    }
    @Patch(':id') update(
        @CurrentUser() actor: AuthUser,
        @Param() { id }: PurchaseOrderIdDto,
        @Body() dto: UpdatePurchaseOrderDto,
    ): Promise<PurchaseOrderView> {
        return this.service.update(actor, id, dto);
    }
    @Post(':id/send') send(
        @CurrentUser() actor: AuthUser,
        @Param() { id }: PurchaseOrderIdDto,
        @Body() dto: PurchaseOrderVersionDto,
    ): Promise<PurchaseOrderView> {
        return this.service.send(actor, id, dto.version);
    }
    @Post(':id/cancel') cancel(
        @CurrentUser() actor: AuthUser,
        @Param() { id }: PurchaseOrderIdDto,
        @Body() dto: PurchaseOrderVersionDto,
    ): Promise<PurchaseOrderView> {
        return this.service.cancel(actor, id, dto.version);
    }
    @Post(':id/receive') receive(
        @CurrentUser() actor: AuthUser,
        @Param() { id }: PurchaseOrderIdDto,
        @Body() dto: ReceivePurchaseOrderDto,
    ): Promise<PurchaseOrderView> {
        return this.service.receive(actor, id, dto);
    }
}
