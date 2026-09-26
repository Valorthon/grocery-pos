import { ASSIGNABLE_ROLES, holdsRole, Role } from './roles.js';

/**
 * What each role may do (issue #24). `roles` is what the API enforces
 * today; `appRoles` and `pages` say what the app offers, which is what the
 * client's Roles page shows (product decision, 2026-09-25). The API's
 * `role-permissions.spec.ts` checks `roles` against every controller's
 * `@Roles(...)`, so the table cannot drift from the server:
 *
 * - every route listed under a permission has exactly `roles` as its
 *   effective `@Roles(...)` (the handler's, else the controller's);
 * - every route that is not `@Public()` is listed under some permission.
 *
 * ADMIN holds every role (`holdsRole`, as in RoleGuard), so a permission
 * whose `roles` do not name ADMIN is still the ADMIN's too.
 */
export interface Permission {
    /** Shown on the Roles page. */
    label: string;
    /** The roles the server lets through, before ADMIN's implied access. */
    roles: readonly Role[];
    /** `METHOD /path` of the routes, without the global `/v1` prefix. */
    routes: readonly string[];
    /**
     * Set when the rule lives inside a handler or service rather than in
     * `@Roles(...)`: names the check, so a reader can find it.
     */
    enforcedBy?: string;
    /**
     * The client pages (route names) that offer this. The client's
     * `role-pages.spec.ts` checks that every role shown the row can open
     * at least one of them.
     */
    pages?: readonly string[];
    /**
     * The roles the Roles page shows it for, exactly as listed: ADMIN is not
     * implied, since the client's seller pages need the SELLER role itself.
     * Absent: every role that holds one of `roles`. Empty: no screen yet,
     * so the page hides it until one exists.
     */
    appRoles?: readonly Role[];
}

export const PERMISSIONS: readonly Permission[] = [
    {
        label: 'Change own password',
        roles: ASSIGNABLE_ROLES,
        routes: ['GET /users/profile', 'PATCH /users/me/password'],
        // No screen for it yet.
        appRoles: [],
    },
    {
        label: 'Stock dashboard',
        roles: [Role.Adjuster, Role.Restocker, Role.UserManager],
        routes: ['GET /dashboard'],
        pages: ['Dashboard'],
    },
    {
        label: 'Sales figures on the dashboard',
        roles: [Role.Admin],
        routes: [],
        enforcedBy: 'DashboardController.getDashboard (includeMoney)',
        pages: ['Dashboard'],
    },
    {
        label: 'Look up products',
        roles: [Role.Restocker, Role.Adjuster, Role.Seller],
        routes: ['GET /products/matches', 'GET /products/:EAN'],
        pages: ['Sell', 'Products/Add', 'Restocks/Add', 'Adjustments/Add'],
    },
    {
        label: 'Run own cash shift',
        roles: [Role.Seller],
        routes: [
            'POST /shifts',
            'GET /shifts/current',
            'POST /shifts/current/drawer',
            'POST /shifts/current/close',
            'GET /shifts/last-closed',
        ],
        pages: ['SellerDashboard'],
        // The /seller pages need the SELLER role itself (router sellerOnly).
        appRoles: [Role.Seller],
    },
    {
        label: 'Sell at the register',
        roles: [Role.Seller],
        routes: ['POST /sales'],
        pages: ['Sell'],
        // The /seller pages need the SELLER role itself (router sellerOnly).
        appRoles: [Role.Seller],
    },
    {
        label: 'View own sales in the open shift',
        roles: [Role.Seller],
        routes: ['GET /sales', 'GET /sales/details/:sales'],
        pages: ['Sales'],
        // The /seller pages need the SELLER role itself (router sellerOnly).
        appRoles: [Role.Seller],
    },
    {
        label: 'View all sales',
        roles: [Role.Admin],
        routes: [],
        enforcedBy: 'saleScope (sales.service.ts)',
        pages: ['SalesHistory'],
    },
    {
        label: 'Void and refund sales',
        roles: [Role.Admin],
        routes: ['POST /sales/:id/void', 'POST /sales/:id/refund'],
        pages: ['SalesHistory'],
    },
    {
        label: 'View and force-close shifts',
        roles: [Role.Admin],
        routes: ['GET /shifts', 'GET /shifts/:id', 'POST /shifts/:id/close'],
        pages: ['Shifts'],
    },
    {
        label: 'View product list',
        roles: [Role.Restocker, Role.Adjuster],
        routes: ['GET /products'],
        pages: ['Products'],
    },
    {
        label: 'Add products',
        roles: [Role.Restocker, Role.Adjuster],
        routes: ['POST /products/bulk', 'GET /products/ensureValid'],
        pages: ['Products/Add'],
        // The Products/Add page is Restocker and Admin only (#61).
        appRoles: [Role.Restocker, Role.Admin],
    },
    {
        label: 'Edit product details (not price)',
        roles: [Role.Restocker, Role.Adjuster],
        routes: ['PATCH /products'],
        // No screen until #38.
        appRoles: [],
    },
    {
        label: 'Change prices',
        roles: [Role.Admin],
        routes: [],
        enforcedBy: 'assertMayChangePrices (product.service.ts)',
        // No screen until #38.
        appRoles: [],
    },
    {
        label: 'View inventory',
        roles: [Role.Restocker, Role.Adjuster],
        routes: ['GET /inventories'],
        pages: ['Inventories'],
    },
    {
        label: 'Create and view restocks',
        roles: [Role.Restocker],
        routes: [
            'POST /restocks',
            'GET /restocks',
            'GET /restocks/details/:restock',
            'GET /restocks/users',
        ],
        pages: ['Restocks', 'Restocks/Add'],
    },
    {
        label: 'Create and view adjustments',
        roles: [Role.Adjuster],
        routes: [
            'POST /adjustments',
            'GET /adjustments',
            'GET /adjustments/details/:adjustment',
            'GET /adjustments/users',
        ],
        pages: ['Adjustments', 'Adjustments/Add'],
    },
    {
        label: 'Manage seller, adjuster and restocker accounts',
        roles: [Role.UserManager],
        routes: ['GET /users', 'POST /users', 'PATCH /users'],
        pages: ['Users'],
    },
    {
        label: "Manage admin and user manager accounts, reset others' passwords",
        roles: [Role.Admin],
        routes: [],
        enforcedBy:
            'user.policy.ts (canManageUser, canGrantRole; assertCanUpdate rule 4 for password resets)',
        pages: ['Users'],
    },
];

/** What the server lets someone holding only `role` do, in table order. */
export function permissionsOf(role: Role): Permission[] {
    return PERMISSIONS.filter((p) => p.roles.some((r) => holdsRole([role], r)));
}

/**
 * What the app offers someone holding only `role`, in table order: the
 * Roles page's rows. A subset of `permissionsOf(role)`.
 */
export function appPermissionsOf(role: Role): Permission[] {
    return permissionsOf(role).filter((p) =>
        p.appRoles ? p.appRoles.includes(role) : true,
    );
}
