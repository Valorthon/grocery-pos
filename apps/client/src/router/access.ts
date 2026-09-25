import { Role } from '@grocery-pos/contracts';

/**
 * Who may open the management dashboard (issue #13). Mirrors
 * `@Roles(...)` on the API's DashboardController (ADMIN passes every check
 * there, so it is listed here explicitly). A SELLER-only cashier is not in
 * the list: the API answers them 403 and the router sends them to the
 * register. Money figures are ADMIN-only; the API leaves them out for the
 * other roles and the Dashboard view hides what is absent.
 */
export const DASHBOARD_ROLES: readonly Role[] = [
    Role.Admin,
    Role.Adjuster,
    Role.Restocker,
    Role.UserManager,
];

export type HomeRoute = { name: 'SellerDashboard' } | { name: 'Dashboard' };

/**
 * Where a signed-in user lands: after login, on `/`, and whenever the
 * router turns them away from a page.
 *
 * - A cashier (SELLER without ADMIN) lands on the register, even if they
 *   also hold a management role.
 * - Everyone else holds a role in DASHBOARD_ROLES (every stored user has at
 *   least one assignable role, and every assignable role other than SELLER
 *   is a dashboard role), so the dashboard never bounces them back here.
 */
export function homeRouteFor(roles: readonly Role[]): HomeRoute {
    const isCashier =
        roles.includes(Role.Seller) && !roles.includes(Role.Admin);
    return { name: isCashier ? 'SellerDashboard' : 'Dashboard' };
}

/** Whether `roles` may open the dashboard. */
export function canViewDashboard(roles: readonly Role[]): boolean {
    return DASHBOARD_ROLES.some((role) => roles.includes(role));
}
