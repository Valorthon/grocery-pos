import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SalesService } from './sales.service';
import {
    GetAllDto,
    GetDetailsDto,
    ReversalType,
    ReverseSaleDto,
    ReverseSaleParamDto,
    SellDto,
} from './types';
import { CurrentUser, Role } from '../auth/types';
import type { AuthUser } from '../auth/types';
import { Roles } from '../auth/auth.decorator';

/**
 * Access decisions (issue #13, product owner 2026-09-24). Handler @Roles
 * replaces the class's; Admin passes every check.
 *
 *   GET  /sales               Seller   own sales only; Admin: all
 *   GET  /sales/details/:id   Seller   own sale only; another cashier's
 *                                      sale is a 404 (not 403), so its
 *                                      existence is not leaked; Admin: any
 *   POST /sales               Seller   records the sale as the caller
 *   POST /sales/:id/void      Admin
 *   POST /sales/:id/refund    Admin
 *
 * Scoping is by cashier (`saleScope`); by shift once #2 lands. Admin
 * reports and CSV are #44. sales.access.e2e.spec.ts pins this.
 */
@Roles(Role.Seller)
@Controller('sales')
export class SalesController {
    constructor(private service: SalesService) {}

    @Get()
    async getAll(@CurrentUser() user: AuthUser, @Query() dto: GetAllDto) {
        const data = await this.service.getAll(user, dto);
        return data;
    }

    @Get('details/:sales')
    async getDetails(
        @CurrentUser() user: AuthUser,
        @Param() dto: GetDetailsDto,
    ) {
        const data = await this.service.getDetails(user, dto);
        return data;
    }

    @Post()
    async sell(@CurrentUser() user: AuthUser, @Body() dto: SellDto) {
        const data = await this.service.sell(user, dto);
        return data;
    }

    /** Reverses a mis-rung sale. Admin only; returns the updated sale. */
    @Roles(Role.Admin)
    @Post(':id/void')
    async voidSale(
        @CurrentUser() user: AuthUser,
        @Param() { id }: ReverseSaleParamDto,
        @Body() dto: ReverseSaleDto,
    ) {
        return await this.service.reverse(user, id, {
            ...dto,
            type: ReversalType.VOID,
        });
    }

    /** Reverses a sale the customer returned. Admin only; returns the updated sale. */
    @Roles(Role.Admin)
    @Post(':id/refund')
    async refundSale(
        @CurrentUser() user: AuthUser,
        @Param() { id }: ReverseSaleParamDto,
        @Body() dto: ReverseSaleDto,
    ) {
        return await this.service.reverse(user, id, {
            ...dto,
            type: ReversalType.REFUND,
        });
    }
}
