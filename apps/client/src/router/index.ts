import { useAuthStore, Role } from '@/stores/auth';
import { Color, useUIStore } from '@/stores/ui';
import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
    // GUEST LAYOUT
    {
        path: '/',
        component: () => import('@/layouts/GuestLayout.vue'),
        children: [
            {
                path: '',
                redirect: 'Login',
            },
            {
                path: 'login',
                name: 'Login',
                component: () => import('@/views/Guest/Login.vue'),
                meta: { guest: true, hideAppBar: true, hideFooter: true },
            },
        ],
    },

    // USER LAYOUT (auth required)
    {
        path: '/admin',
        component: () => import('@/layouts/UserLayout.vue'),
        meta: { requiresAuth: true },
        children: [
            {
                path: '',
                name: 'Dashboard',
                component: () => import('@/views/User/Dashboard.vue'),
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
                path: 'sell',
                name: 'Sell',
                component: () => import('@/views/User/Sales/Sell.vue'),
                meta: { roles: [Role.Seller, Role.Admin] },
            },
            {
                path: 'sales',
                name: 'Sales',
                component: () => import('@/views/User/Sales/Index.vue'),
                meta: { roles: [Role.Seller, Role.Admin] },
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

// Dynamic import error handling
router.onError((err, to) => {
    if (
        err?.message?.includes?.('Failed to fetch dynamically imported module')
    ) {
        if (!localStorage.getItem('vuetify:dynamic-reload')) {
            localStorage.setItem('vuetify:dynamic-reload', 'true');
            location.assign(to.fullPath);
        }
    }
});

router.isReady().then(() => {
    localStorage.removeItem('vuetify:dynamic-reload');
});

// Navigation Guard
router.beforeEach((to) => {
    const authStore = useAuthStore();
    const isAuthenticated = authStore.isAuthenticated;

    const requiresAuth = to.matched.some((r) => r.meta?.requiresAuth);

    // Not logged in, trying to access protected route → redirect to login
    if (requiresAuth && !isAuthenticated) {
        const uiStore = useUIStore();
        uiStore.queueMessage(Color.ERROR, 'Please log in to continue');
        return { name: 'Login' };
    }

    // Already logged in, trying to access login page → redirect to dashboard
    if (to.name === 'Login' && isAuthenticated) {
        return { name: 'Dashboard' };
    }

    // Role guard
    const requiredRoles = to.meta?.roles as Role[] | undefined;
    if (requiredRoles && requiredRoles.length > 0) {
        const hasRole =
            authStore.isAdmin ||
            requiredRoles.some((role) => authStore.hasRole(role));
        if (!hasRole) {
            const uiStore = useUIStore();
            uiStore.queueMessage(
                Color.ERROR,
                'You do not have access to that page',
            );
            return { name: 'Dashboard' };
        }
    }

    return true;
});

export default router;
