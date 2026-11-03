import {
    Body,
    Controller,
    Get,
    Headers,
    Param,
    Post,
    Query,
} from '@nestjs/common';
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
import { RequireOwnRole, Roles } from '../auth/auth.decorator';
import type {
    Paginated,
    Receipt,
    SaleLine,
    SaleRow,
    SaleView,
} from '@grocery-pos/contracts';
import { asJson } from '../common/wire';

/**
 * Access decisions (issue #13, product owner 2026-09-24; narrowed to the
 * current shift by #2). Handler @Roles replaces the class's; Admin passes
 * every check except POST /sales, which is @RequireOwnRole(Seller): an
 * admin account also needs SELLER to sell (issue #84).
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
 *                                      without one); SELLER itself, ADMIN
 *                                      alone is 403
 *   POST /sales/:id/void      Seller   own current-shift sale with manager PIN;
 *   POST /sales/:id/refund    Admin    any sale with PIN and payout-shift rules
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
    async getAll(
        @CurrentUser() user: AuthUser,
        @Query() dto: GetAllDto,
    ): Promise<Paginated<SaleRow>> {
        return asJson(await this.service.getAll(user, dto));
    }

    @Get('details/:sales')
    async getDetails(
        @CurrentUser() user: AuthUser,
        @Param() dto: GetDetailsDto,
    ): Promise<SaleLine[]> {
        return asJson(await this.service.getDetails(user, dto));
    }

    @RequireOwnRole(Role.Seller)
    @Post()
    async sell(
        @CurrentUser() user: AuthUser,
        @Body() dto: SellDto,
        @Headers('x-manager-approval') approvalToken?: string,
    ): Promise<Receipt> {
        return asJson(
            await this.service.sell(user, dto, undefined, approvalToken),
        );
    }

    /** Reverses a mis-rung sale. Manager approval required; cashiers are scoped to their current shift. */
    @Roles(Role.Seller, Role.Admin)
    @Post(':id/void')
    async voidSale(
        @CurrentUser() user: AuthUser,
        @Param() { id }: ReverseSaleParamDto,
        @Body() dto: ReverseSaleDto,
        @Headers('x-manager-approval') approvalToken?: string,
    ): Promise<SaleView> {
        return asJson(
            await this.service.reverse(
                user,
                id,
                {
                    ...dto,
                    type: ReversalType.VOID,
                },
                undefined,
                approvalToken,
            ),
        );
    }

    /** Reverses a sale the customer returned. Manager approval required; cashiers are scoped to their current shift. */
    @Roles(Role.Seller, Role.Admin)
    @Post(':id/refund')
    async refundSale(
        @CurrentUser() user: AuthUser,
        @Param() { id }: ReverseSaleParamDto,
        @Body() dto: ReverseSaleDto,
        @Headers('x-manager-approval') approvalToken?: string,
    ): Promise<SaleView> {
        return asJson(
            await this.service.reverse(
                user,
                id,
                {
                    ...dto,
                    type: ReversalType.REFUND,
                },
                undefined,
                approvalToken,
            ),
        );
    }
}
