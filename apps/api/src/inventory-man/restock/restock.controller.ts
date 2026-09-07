import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RestockService } from './restock.service';
import {
    GetAllDto,
    GetDetailsParamDto,
    GetDetailsQueryDto,
    RestockDto,
} from './types';
import { CurrentUser, Role } from '../../auth/types';
import type { AuthUser } from '../../auth/types';
import { Roles } from '../../auth/auth.decorator';
@Roles(Role.Restocker)
@Controller('restocks')
export class RestockController {
    constructor(private service: RestockService) {}

    @Post()
    async restock(@CurrentUser() user: AuthUser, @Body() dto: RestockDto) {
        await this.service.restock(user, dto);
    }

    @Get()
    async getAll(@Query() dto: GetAllDto) {
        const data = await this.service.getAll(dto);
        return data;
    }

    @Get('details/:restock')
    async getDetails(
        @Param() paramDto: GetDetailsParamDto,
        @Query() queryDto: GetDetailsQueryDto,
    ) {
        const data = await this.service.getDetails({
            ...paramDto,
            ...queryDto,
        });

        return data;
    }

    @Get('users')
    async getRestockUsers() {
        const data = await this.service.getRestockUsers();
        return data;
    }
}
