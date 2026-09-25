import { useAuthStore, Role } from '@/stores/auth';
import { Color, useUIStore } from '@/stores/ui';
import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { DASHBOARD_ROLES, homeRouteFor } from './access';

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
                meta: { guest: true, hideAppBar: true, hideFooter: true },
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
            },
            {
                path: 'register',
                name: 'Sell',
                component: () => import('@/views/User/Sales/Sell.vue'),
            },
            {
                path: 'orders',
                name: 'Sales',
                component: () => import('@/views/User/Sales/Index.vue'),
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
                meta: { roles: [...DASHBOARD_ROLES] },
            },
            {
                // Admins void and refund sales from here; sellers see the
                // same view under /seller/orders.
                path: 'sales',
                name: 'SalesHistory',
                component: () => import('@/views/User/Sales/Index.vue'),
                meta: { roles: [Role.Admin] },
            },

            {
                path: 'products',
                name: 'Products',
                component: () => import('@/views/User/Products/Index.vue'),
                meta: { roles: [Role.Restocker, Role.Adjuster, Role.Admin] },
            },
            {
                path: 'products/add',
                name: 'Products/Add',
                component: () => import('@/views/User/Products/Add.vue'),
                meta: { roles: [Role.Restocker, Role.Admin] },
            },

            {
                path: 'inventories',
                name: 'Inventories',
                component: () => import('@/views/User/Inventories.vue'),
                meta: { roles: [Role.Restocker, Role.Adjuster, Role.Admin] },
            },

            {
                path: 'restocks',
                name: 'Restocks',
                component: () => import('@/views/User/Restock/Index.vue'),
                meta: { roles: [Role.Restocker, Role.Admin] },
            },
            {
                path: 'restocks/add',
                name: 'Restocks/Add',
                component: () => import('@/views/User/Restock/Add.vue'),
                meta: { roles: [Role.Restocker, Role.Admin] },
            },

            {
                path: 'adjustments',
                name: 'Adjustments',
                component: () => import('@/views/User/Adjustments/Index.vue'),
                meta: { roles: [Role.Adjuster, Role.Admin] },
            },
            {
                path: 'adjustments/add',
                name: 'Adjustments/Add',
                component: () => import('@/views/User/Adjustments/Add.vue'),
                meta: { roles: [Role.Adjuster, Role.Admin] },
            },

            {
                path: 'users',
                name: 'Users',
                component: () => import('@/views/User/Users/Index.vue'),
                meta: { roles: [Role.UserManager, Role.Admin] },
            },
            {
                path: 'roles',
                name: 'Roles',
                component: () => import('@/views/User/Roles/Index.vue'),
                meta: { roles: [Role.UserManager, Role.Admin] },
            },
        ],
    },

    {
        path: '/:pathMatch(.*)*',
        name: 'NotFound',
        redirect: { name: 'Login' },
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
    return homeRouteFor(authStore.user?.roles ?? []);
}

// Navigation Guard
router.beforeEach((to) => {
    const authStore = useAuthStore();
    const uiStore = useUIStore();
    const isAuthenticated = authStore.isAuthenticated;

    const requiresAuth = to.matched.some((r) => r.meta?.requiresAuth);

    if (requiresAuth && !isAuthenticated) {
        uiStore.queueMessage(Color.ERROR, 'Please log in to continue');
        return { name: 'Login' };
    }

    if (to.name === 'Login' && isAuthenticated) {
        return homeFor(authStore);
    }

    // Seller-only routes: only users with SELLER role (admins cannot sell)
    if (to.meta?.sellerOnly && !authStore.hasRole(Role.Seller)) {
        uiStore.queueMessage(
            Color.ERROR,
            'You do not have access to that page',
        );
        return homeFor(authStore);
    }

    const requiredRoles = to.meta?.roles as Role[] | undefined;
    if (requiredRoles && requiredRoles.length > 0) {
        const hasRole =
            authStore.isAdmin ||
            requiredRoles.some((role) => authStore.hasRole(role));
        if (!hasRole) {
            uiStore.queueMessage(
                Color.ERROR,
                'You do not have access to that page',
            );
            return homeFor(authStore);
        }
    }

    return true;
});

export default router;
