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
@Roles(Role.Seller)
@Controller('sales')
export class SalesController {
    constructor(private service: SalesService) {}

    @Get()
    async getAll(@Query() dto: GetAllDto) {
        const data = await this.service.getAll(dto);
        return data;
    }

    @Get('details/:sales')
    async getDetails(@Param() dto: GetDetailsDto) {
        const data = await this.service.getDetails(dto);
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
