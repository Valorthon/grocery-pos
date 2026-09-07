import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SalesService } from './sales.service';
import { GetAllDto, GetDetailsDto, SellDto } from './types';
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
}
