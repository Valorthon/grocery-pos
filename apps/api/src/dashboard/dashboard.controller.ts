import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Roles } from '../auth/auth.decorator';
import { CurrentUser, Role } from '../auth/types';
import type { AuthUser } from '../auth/types';
import type { DashboardView } from '@grocery-pos/contracts';
import { asJson } from '../common/wire';

/**
 * Access decision (issue #13, product owner 2026-09-24):
 *
 *   GET /dashboard   Admin, Adjuster, Restocker, UserManager
 *
 * - The dashboard is the management landing page, so every management role
 *   reaches it; USER_MANAGER included, otherwise a user-manager-only account
 *   would have no page to land on after login.
 * - A SELLER-only cashier gets 403: store-wide figures are not theirs to see.
 * - On the dashboard, money (today's revenue, the recent-sales feed, and
 *   the restock `totalCost` in the activity feed) is ADMIN-only and is left
 *   out server-side for everyone else; see DashboardService.getDashboard.
 *   This hides restock costs on the dashboard only: restockers still see
 *   costs in their restock history (/restocks), which #13 does not change.
 *
 * dashboard.access.e2e.spec.ts pins this.
 */
@Roles(Role.Adjuster, Role.Restocker, Role.UserManager)
@Controller('dashboard')
export class DashboardController {
    constructor(private service: DashboardService) {}

    @Get()
    async getDashboard(@CurrentUser() user: AuthUser): Promise<DashboardView> {
        return asJson(
            await this.service.getDashboard({
                includeMoney: user.roles.includes(Role.Admin),
            }),
        );
    }
}
