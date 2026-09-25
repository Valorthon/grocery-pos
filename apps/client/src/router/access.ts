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

export type HomeRoute =
    { name: 'SellerDashboard' } | { name: 'Dashboard' } | { name: 'Login' };

/**
 * Where a signed-in user lands: after login, on `/`, and whenever the
 * router turns them away from a page.
 *
 * - A cashier (SELLER without ADMIN) lands on the register, even if they
 *   also hold a management role.
 * - A user holding a role in DASHBOARD_ROLES lands on the dashboard.
 * - Anyone else (a stale session with no roles, or only legacy ones) has no
 *   page at all and goes to Login. The router ends such a session as it
 *   sends them there (see `homeFor` in ./index.ts); otherwise Login, seeing
 *   a signed-in user, would send them straight back here in a loop.
 */
export function homeRouteFor(roles: readonly Role[]): HomeRoute {
    if (roles.includes(Role.Seller) && !roles.includes(Role.Admin)) {
        return { name: 'SellerDashboard' };
    }
    if (canViewDashboard(roles)) return { name: 'Dashboard' };
    return { name: 'Login' };
}

/** Whether `roles` may open the dashboard. */
export function canViewDashboard(roles: readonly Role[]): boolean {
    return DASHBOARD_ROLES.some((role) => roles.includes(role));
}

/** The role parts of a route's (merged) meta that the router checks. */
export interface RouteAccessMeta {
    sellerOnly?: boolean;
    roles?: readonly Role[];
}

/**
 * Whether someone holding `roles` may open a route with `meta`, as the
 * router's guard decides it: a `sellerOnly` route needs the SELLER role
 * itself (ADMIN alone is not enough), and a route with `roles` needs ADMIN
 * or one of them.
 */
export function canOpenRoute(
    meta: RouteAccessMeta,
    roles: readonly Role[],
): boolean {
    if (meta.sellerOnly && !roles.includes(Role.Seller)) return false;
    const required = meta.roles;
    if (required && required.length > 0) {
        return (
            roles.includes(Role.Admin) ||
            required.some((role) => roles.includes(role))
        );
    }
    return true;
}
