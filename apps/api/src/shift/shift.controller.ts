import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequireOwnRole, Roles } from '../auth/auth.decorator';
import { CurrentUser, Role } from '../auth/types';
import type { AuthUser } from '../auth/types';
import { ShiftService } from './shift.service';
import type {
    CurrentShiftResponse,
    CurrentShiftView,
    LastClosedResponse,
    Paginated,
    ShiftListItem,
    ZReadReport,
} from '@grocery-pos/contracts';
import {
    CloseShiftDto,
    DrawerMovementDto,
    ListShiftsDto,
    OpenShiftDto,
    ShiftIdParamDto,
} from './types';

/**
 * Cash shifts (issue #2, product owner 2026-09-25). Handler @Roles replaces
 * the class's. The cashier routes are @RequireOwnRole(Seller): ADMIN alone
 * does not pass them, so an admin account also needs SELLER to run a
 * shift and sell (issue #84). The Admin routes are plain @Roles(Admin).
 *
 *   (Seller: the SELLER role itself; ADMIN alone is 403)
 *   POST /shifts                  Seller  open own shift (counted float)
 *   GET  /shifts/current          Seller  own open shift, blind: no
 *                                         expected cash, sales or variance
 *   POST /shifts/current/drawer   Seller  cash in / cash drop, own shift
 *   POST /shifts/current/close    Seller  blind count; returns the Z-read
 *   GET  /shifts/last-closed      Seller  own most recent Z-read
 *   GET  /shifts                  Admin   every shift, newest first
 *   GET  /shifts/:id              Admin   any shift and its Z-read
 *   POST /shifts/:id/close        Admin   force-close with a count
 *
 * A cashier only ever reaches their own shift: the "current" routes look
 * it up by the caller, and every route taking an id is Admin-only.
 * shift.access.e2e.spec.ts pins this.
 */
@RequireOwnRole(Role.Seller)
@Controller('shifts')
export class ShiftController {
    constructor(private service: ShiftService) {}

    @Post()
    async open(
        @CurrentUser() user: AuthUser,
        @Body() dto: OpenShiftDto,
    ): Promise<CurrentShiftView> {
        return await this.service.open(user, dto.counts);
    }

    @Get('current')
    async current(
        @CurrentUser() user: AuthUser,
    ): Promise<CurrentShiftResponse> {
        return { shift: await this.service.current(user) };
    }

    @Post('current/drawer')
    async drawer(
        @CurrentUser() user: AuthUser,
        @Body() dto: DrawerMovementDto,
    ): Promise<CurrentShiftView> {
        return await this.service.recordDrawer(user, dto);
    }

    @Post('current/close')
    async closeOwn(
        @CurrentUser() user: AuthUser,
        @Body() dto: CloseShiftDto,
    ): Promise<ZReadReport> {
        return await this.service.closeOwn(user, dto.counts);
    }

    @Get('last-closed')
    async lastClosed(
        @CurrentUser() user: AuthUser,
    ): Promise<LastClosedResponse> {
        return { report: await this.service.lastClosed(user) };
    }

    @Roles(Role.Admin)
    @Get()
    async list(@Query() dto: ListShiftsDto): Promise<Paginated<ShiftListItem>> {
        return await this.service.list(dto);
    }

    @Roles(Role.Admin)
    @Get(':id')
    async getById(@Param() { id }: ShiftIdParamDto): Promise<ShiftListItem> {
        return await this.service.getById(id);
    }

    @Roles(Role.Admin)
    @Post(':id/close')
    async forceClose(
        @CurrentUser() user: AuthUser,
        @Param() { id }: ShiftIdParamDto,
        @Body() dto: CloseShiftDto,
    ): Promise<ZReadReport> {
        return await this.service.closeById(user, id, dto.counts);
    }
}
