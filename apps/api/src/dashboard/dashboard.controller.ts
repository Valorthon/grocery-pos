import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Roles } from '../auth/auth.decorator';
import { CurrentUser, Role } from '../auth/types';
import type { AuthUser } from '../auth/types';

/**
 * Access decision (issue #13, product owner 2026-09-24):
 *
 *   GET /dashboard   Admin, Adjuster, Restocker, UserManager
 *
 * - The dashboard is the management landing page, so every management role
 *   reaches it; USER_MANAGER included, otherwise a user-manager-only account
 *   would have no page to land on after login.
 * - A SELLER-only cashier gets 403: store-wide figures are not theirs to see.
 * - Money (today's revenue, the recent-sales feed, restock costs) is
 *   ADMIN-only and is left out server-side for everyone else; see
 *   DashboardService.getDashboard.
 *
 * dashboard.access.e2e.spec.ts pins this.
 */
@Roles(Role.Adjuster, Role.Restocker, Role.UserManager)
@Controller('dashboard')
export class DashboardController {
    constructor(private service: DashboardService) {}

    @Get()
    async getDashboard(@CurrentUser() user: AuthUser) {
        return await this.service.getDashboard({
            includeMoney: user.roles.includes(Role.Admin),
        });
    }
}
