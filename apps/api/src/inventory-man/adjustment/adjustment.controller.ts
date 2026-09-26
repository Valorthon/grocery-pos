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
import type {
    AdjustmentLine,
    Paginated,
    AdjustmentRow,
    UserRef,
} from '@grocery-pos/contracts';
import { asJson } from '../../common/wire';
@Roles(Role.Adjuster)
@Controller('adjustments')
export class AdjustmentController {
    constructor(private service: AdjustmentService) {}

    @Post()
    async adjust(@CurrentUser() user: AuthUser, @Body() dto: AdjustDto) {
        await this.service.adjust(user, dto);
    }

    @Get()
    async getAll(@Query() dto: GetAllDto): Promise<Paginated<AdjustmentRow>> {
        return asJson(await this.service.getAll(dto));
    }

    @Get('details/:adjustment')
    async getDetails(
        @Param() paramDto: GetDetailsParamDto,
        @Query() queryDto: GetDetailsQueryDto,
    ): Promise<Paginated<AdjustmentLine>> {
        return asJson(
            await this.service.getDetails({
                ...paramDto,
                ...queryDto,
            }),
        );
    }

    @Get('users')
    async getAdjustUsers(): Promise<UserRef[]> {
        return asJson(await this.service.getAdjustUsers());
    }
}
