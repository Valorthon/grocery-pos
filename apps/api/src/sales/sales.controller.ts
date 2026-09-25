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
 * Access decisions (issue #13, product owner 2026-09-24; narrowed to the
 * current shift by #2). Handler @Roles replaces the class's; Admin passes
 * every check.
 *
 *   GET  /sales               Seller   own sales in the caller's current
 *                                      open shift only (none without one);
 *                                      Admin: all
 *   GET  /sales/details/:id   Seller   a sale in that same scope; any other
 *                                      (another cashier's, or their own
 *                                      from another shift) is a 404, not a
 *                                      403, so its existence is not leaked;
 *                                      Admin: any
 *   POST /sales               Seller   records the sale as the caller, into
 *                                      their open shift (409 SHIFT_NOT_OPEN
 *                                      without one)
 *   POST /sales/:id/void      Admin    pays the net cash back out of a
 *   POST /sales/:id/refund    Admin    shift's drawer (`payoutShiftId`)
 *
 * Scoping is `saleScope`. `GET /sales` also takes `cashier` and
 * `dateFrom`/`dateTo` (#16): for an Admin they filter every sale; for anyone
 * else they only narrow the scope above, and naming another cashier lists
 * nothing (`salesListFilter`). Admin reports and CSV are #44.
 * sales.access.e2e.spec.ts pins this.
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
