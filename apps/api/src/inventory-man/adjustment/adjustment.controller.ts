import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AdjustmentService } from './adjustment.service';
import {
    AdjustDto,
    GetAllDto,
    GetDetailsParamDto,
    GetDetailsQueryDto,
} from './types';
import { CurrentUser, Role } from '../../auth/types';
import type { AuthUser } from '../../auth/types';
import { Roles } from '../../auth/auth.decorator';
@Roles(Role.Adjuster)
@Controller('adjustments')
export class AdjustmentController {
    constructor(private service: AdjustmentService) {}

    @Post()
    async adjust(@CurrentUser() user: AuthUser, @Body() dto: AdjustDto) {
        await this.service.adjust(user, dto);
    }

    @Get()
    async getAll(@Query() dto: GetAllDto) {
        const data = await this.service.getAll(dto);
        return data;
    }

    @Get('details/:adjustment')
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
    async getAdjustUsers() {
        const data = await this.service.getAdjustUsers();
        return data;
    }
}
