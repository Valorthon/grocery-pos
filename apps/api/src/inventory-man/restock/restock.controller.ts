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
import type {
    RestockLine,
    Paginated,
    RestockRow,
    UserRef,
} from '@grocery-pos/contracts';
import { asJson } from '../../common/wire';
@Roles(Role.Restocker)
@Controller('restocks')
export class RestockController {
    constructor(private service: RestockService) {}

    @Post()
    async restock(@CurrentUser() user: AuthUser, @Body() dto: RestockDto) {
        await this.service.restock(user, dto);
    }

    @Get()
    async getAll(@Query() dto: GetAllDto): Promise<Paginated<RestockRow>> {
        return asJson(await this.service.getAll(dto));
    }

    @Get('details/:restock')
    async getDetails(
        @Param() paramDto: GetDetailsParamDto,
        @Query() queryDto: GetDetailsQueryDto,
    ): Promise<Paginated<RestockLine>> {
        return asJson(
            await this.service.getDetails({
                ...paramDto,
                ...queryDto,
            }),
        );
    }

    @Get('users')
    async getRestockUsers(): Promise<UserRef[]> {
        return asJson(await this.service.getRestockUsers());
    }
}
