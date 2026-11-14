import { useAuthStore, Role } from '@/stores/auth';
import { Color, useUIStore } from '@/stores/ui';
import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import {
    canOpenRoute,
    DASHBOARD_ROLES,
    homeRouteFor,
    type RouteAccessMeta,
} from './access';
import { pageTitle, routeTitle } from './page-title';

const routes: RouteRecordRaw[] = [
    // GUEST LAYOUT
    {
        path: '/',
        component: () => import('@/layouts/GuestLayout.vue'),
        children: [
            {
                path: '',
                redirect: { name: 'Login' },
            },
            {
                path: 'login',
                name: 'Login',
                component: () => import('@/views/Guest/Login.vue'),
                meta: {
                    title: 'Log in',
                    guest: true,
                    hideAppBar: true,
                    hideFooter: true,
                },
            },
        ],
    },

    // SELLER LAYOUT (SELLER role only)
    {
        path: '/seller',
        component: () => import('@/layouts/SellerLayout.vue'),
        meta: { requiresAuth: true, sellerOnly: true, roles: [Role.Seller] },
        children: [
            {
                path: '',
                name: 'SellerDashboard',
                component: () =>
                    import('@/views/User/Sales/SellerDashboard.vue'),
                meta: { title: 'Dashboard' },
            },
            {
                path: 'register',
                name: 'Sell',
                component: () => import('@/views/User/Sales/Sell.vue'),
                meta: { title: 'Register' },
            },
            {
                path: 'orders',
                name: 'Sales',
                component: () => import('@/views/User/Sales/Index.vue'),
                meta: {
                    title: 'Sales history',
                    description:
                        "Your sales in your current shift. Voids and refunds need a manager's approval.",
                },
            },
        ],
    },

    // USER LAYOUT (management roles)
    {
        path: '/admin',
        component: () => import('@/layouts/UserLayout.vue'),
        meta: { requiresAuth: true },
        children: [
            {
                // Management roles only; money tiles are ADMIN-only (the
                // API leaves them out). See DASHBOARD_ROLES.
                path: '',
                name: 'Dashboard',
                component: () => import('@/views/User/Dashboard.vue'),
                meta: { title: 'Dashboard', roles: [...DASHBOARD_ROLES] },
            },
            {
                path: 'settings',
                name: 'Settings',
                component: () => import('@/views/User/Settings/Index.vue'),
                meta: {
                    title: 'Store settings',
                    description:
                        "Your store's name, timezone and defaults. A timezone change needs all shifts closed and terminals released.",
                    roles: [Role.Admin],
                },
            },
            {
                path: 'audit',
                name: 'AuditLog',
                component: () => import('@/views/User/Audit/Index.vue'),
                meta: {
                    title: 'Audit log',
                    description:
                        "Sensitive actions such as price changes, discounts and voids. Entries can't be edited or deleted in the app.",
                    roles: [Role.Admin],
                },
            },
            {
                path: 'reports',
                name: 'Reports',
                component: () => import('@/views/User/Reports/Index.vue'),
                meta: {
                    title: 'Sales reports',
                    description:
                        'Sales, discounts, costs and margins for any date range, with CSV export.',
                    roles: [Role.Admin],
                },
            },
            {
                // Admins void and refund sales from here; sellers see the
                // same view under /seller/orders.
                path: 'sales',
                name: 'SalesHistory',
                component: () => import('@/views/User/Sales/Index.vue'),
                meta: {
                    title: 'Sales history',
                    description:
                        'Every sale, with payment, cashier and items. Open a sale to void or refund it.',
                    roles: [Role.Admin],
                },
            },
            {
                // Every cashier's shifts and Z-reads, and force-close
                // (issue #2). The API's list, view and force-close routes
                // are Admin-only too.
                path: 'shifts',
                name: 'Shifts',
                component: () => import('@/views/User/Shifts/Index.vue'),
                meta: {
                    title: 'Shifts',
                    description:
                        "Every cashier's shifts, newest first, with their close reports. Force-close a shift left open.",
                    roles: [Role.Admin],
                },
            },

            {
                path: 'suppliers',
                name: 'Suppliers',
                component: () => import('@/views/User/Suppliers/Index.vue'),
                meta: {
                    title: 'Suppliers',
                    description:
                        'The suppliers you buy from. Archive one instead of deleting it to keep its receipts.',
                    roles: [Role.Restocker, Role.Admin],
                },
            },
            {
                path: 'categories',
                name: 'Categories',
                component: () => import('@/views/User/Categories/Index.vue'),
                meta: {
                    title: 'Categories',
                    description:
                        'Group products for filters and reports. Archiving a category keeps its products on sale.',
                    roles: [Role.Admin],
                },
            },
            {
                path: 'products',
                name: 'Products',
                component: () => import('@/views/User/Products/Index.vue'),
                meta: {
                    title: 'Product list',
                    description:
                        'Look up products and stock. Restockers edit, archive and set low stock levels; only an admin changes prices.',
                    roles: [Role.Restocker, Role.Adjuster, Role.Admin],
                },
            },
            {
                path: 'products/add',
                name: 'Products/Add',
                component: () => import('@/views/User/Products/Add.vue'),
                meta: {
                    title: 'New products',
                    description:
                        "Add products with barcode, unit and price. A product's unit can't be changed later.",
                    roles: [Role.Restocker, Role.Admin],
                },
            },

            {
                path: 'inventories',
                name: 'Inventories',
                component: () => import('@/views/User/Inventories.vue'),
                meta: {
                    title: 'Inventory',
                    description:
                        'Stock on hand for every product, with batches and expiry dates.',
                    queryTitle: [
                        {
                            key: 'lowStock',
                            value: 'true',
                            title: 'Low stock',
                            description:
                                'Active products at or below their low stock level, biggest shortfall first.',
                        },
                        {
                            key: 'outOfStock',
                            value: 'true',
                            title: 'Out of stock',
                            description:
                                'Active products with no stock left, including negative stock.',
                        },
                    ],
                    roles: [Role.Restocker, Role.Adjuster, Role.Admin],
                },
            },

            {
                path: 'restocks',
                name: 'Restocks',
                component: () => import('@/views/User/Restock/Index.vue'),
                meta: {
                    title: 'Restock history',
                    description:
                        'Every stock receipt, with supplier, quantities, costs and invoice numbers.',
                    roles: [Role.Restocker, Role.Admin],
                },
            },
            {
                path: 'restocks/add',
                name: 'Restocks/Add',
                component: () => import('@/views/User/Restock/Add.vue'),
                meta: {
                    title: 'New restock',
                    description:
                        'Record goods received from a supplier. Stock goes up when you save.',
                    roles: [Role.Restocker, Role.Admin],
                },
            },

            {
                path: 'purchase-orders',
                name: 'PurchaseOrders',
                component: () =>
                    import('@/views/User/PurchaseOrders/Index.vue'),
                meta: {
                    title: 'Purchase orders',
                    description:
                        'Order stock from suppliers and receive it on arrival. Stock changes only when you receive.',
                    roles: [Role.Restocker, Role.Admin],
                },
            },
            {
                path: 'stock-counts',
                name: 'StockCounts',
                component: () => import('@/views/User/StockCounts/Index.vue'),
                meta: {
                    title: 'Stock counts',
                    description:
                        "Count what's on the shelves. Stock changes only after an admin or supervisor approves the count.",
                    roles: [Role.Adjuster, Role.Admin],
                },
            },
            {
                path: 'adjustments',
                name: 'Adjustments',
                component: () => import('@/views/User/Adjustments/Index.vue'),
                meta: {
                    title: 'Adjustment history',
                    description:
                        'Every manual stock correction, with its reason and who made it.',
                    roles: [Role.Adjuster, Role.Admin],
                },
            },
            {
                path: 'adjustments/add',
                name: 'Adjustments/Add',
                component: () => import('@/views/User/Adjustments/Add.vue'),
                meta: {
                    title: 'New adjustment',
                    description:
                        'Correct stock for damage, loss or miscounts. Each line needs a reason.',
                    roles: [Role.Adjuster, Role.Admin],
                },
            },

            {
                path: 'users',
                name: 'Users',
                component: () => import('@/views/User/Users/Index.vue'),
                meta: {
                    title: 'Users',
                    description:
                        'Add staff accounts and choose their roles. Only an admin manages admin and user-manager accounts and PINs.',
                    roles: [Role.UserManager, Role.Admin],
                },
            },
            {
                path: 'roles',
                name: 'Roles',
                component: () => import('@/views/User/Roles/Index.vue'),
                meta: {
                    title: 'Roles',
                    description:
                        'What each role can see and do. Give a user several roles to combine them.',
                    roles: [Role.UserManager, Role.Admin],
                },
            },
        ],
    },

    {
        path: '/:pathMatch(.*)*',
        // Unknown paths (#162). Known protected routes match above and
        // still send a logged-out visitor to Login.
        name: 'NotFound',
        component: () => import('@/views/NotFound.vue'),
        meta: { title: 'Page not found' },
    },
];

const router = createRouter({
    history: createWebHistory(),
    routes,
    scrollBehavior() {
        return { top: 0 };
    },
});

function homeFor(authStore: ReturnType<typeof useAuthStore>) {
    const home = homeRouteFor(authStore.user?.roles ?? []);

    if (home.name === 'Login') {
        // A session whose roles open no page (none, or only legacy ones).
        // Drop the local user now, synchronously, so the redirect to Login
        // is not bounced straight back here as "already logged in"; then
        // end the server session too (best-effort, as logout always is).
        authStore.user = null;
        localStorage.removeItem('user');
        void authStore.logout(
            'Your account has no access. Please log in again.',
        );
    }

    return home;
}

// Navigation Guard
router.beforeEach(async (to) => {
    const authStore = useAuthStore();
    const uiStore = useUIStore();
    // Decide on the server's current roles, not the localStorage copy: the
    // first navigation waits for the one-off profile fetch (later ones get
    // the settled promise). A 401 there has cleared the user, so a
    // protected route falls through to Login below; Login itself needs no
    // session, so this cannot loop.
    await authStore.initSession();
    const isAuthenticated = authStore.isAuthenticated;

    const requiresAuth = to.matched.some((r) => r.meta?.requiresAuth);

    if (requiresAuth && !isAuthenticated) {
        // The session is gone (cookie expired or cleared) without a
        // logout: drop the register state as logout does. Local only, no
        // navigation, so this cannot loop.
        authStore.resetRegister();
        uiStore.queueMessage(Color.ERROR, 'Please log in to continue');
        return { name: 'Login' };
    }

    // A temporary password (#361): the API refuses everything until it is
    // changed, so the account stays on Login, where the change is asked.
    if (isAuthenticated && authStore.user?.mustChangePassword) {
        return to.name === 'Login' ? true : { name: 'Login' };
    }

    // Logging out goes to Login before the session ends (requestLogout).
    if (
        to.name === 'Login' &&
        isAuthenticated &&
        !authStore.userLogoutPending
    ) {
        return homeFor(authStore);
    }

    // Seller-only routes need the SELLER role itself (ADMIN alone cannot
    // sell); other routes need ADMIN or one of their `roles`. The Roles
    // page's rows are checked against the same rule (role-pages.spec.ts).
    if (
        !canOpenRoute(to.meta as RouteAccessMeta, authStore.user?.roles ?? [])
    ) {
        uiStore.queueMessage(
            Color.ERROR,
            'You do not have access to that page',
        );
        return homeFor(authStore);
    }

    return true;
});

// A route's `meta.title` names the tab. A cancelled or redirected
// navigation (a draft guard's "Stay") keeps the current page's title.
router.afterEach((to, _from, failure) => {
    if (failure) return;
    document.title = pageTitle(routeTitle(to));
});

export default router;
