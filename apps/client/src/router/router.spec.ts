import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { ASSIGNABLE_ROLES, Role } from '@grocery-pos/contracts';
import { canViewDashboard, DASHBOARD_ROLES, homeRouteFor } from './access';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/axios', () => ({ default: { post, get: vi.fn() } }));

/** Roles a stale session may still carry that open no page. */
const LEGACY_ONLY: Role[] = ['CASHIER' as Role];
const NO_PAGE_SETS: Role[][] = [[], LEGACY_ONLY, [Role.Unauthenticated]];

// The views are lazy-loaded; stub them so a navigation resolves without
// pulling in each page.
const stub = { default: defineComponent({ render: () => null }) };
vi.mock('@/layouts/GuestLayout.vue', () => stub);
vi.mock('@/layouts/SellerLayout.vue', () => stub);
vi.mock('@/layouts/UserLayout.vue', () => stub);
vi.mock('@/views/Guest/Login.vue', () => stub);
vi.mock('@/views/User/Sales/SellerDashboard.vue', () => stub);
vi.mock('@/views/User/Sales/Index.vue', () => stub);
vi.mock('@/views/User/Dashboard.vue', () => stub);
vi.mock('@/views/User/Products/Index.vue', () => stub);
vi.mock('@/views/User/Shifts/Index.vue', () => stub);
vi.mock('@/views/User/Users/Index.vue', () => stub);

function signIn(roles: Role[]) {
    localStorage.setItem('user', JSON.stringify({ username: 'u', roles }));
    Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => 'dummy=true',
    });
}

async function freshRouter() {
    vi.resetModules();
    setActivePinia(createPinia());
    const { default: router } = await import('./index');
    return router;
}

/**
 * Every combination of assignable roles, including none, plus sessions
 * holding only legacy or unassignable roles.
 */
function roleSets(): Role[][] {
    const roles = [...ASSIGNABLE_ROLES];
    const sets: Role[][] = [];
    for (let mask = 0; mask < 1 << roles.length; mask++) {
        sets.push(roles.filter((_, i) => mask & (1 << i)));
    }
    return [...sets, LEGACY_ONLY, [Role.Unauthenticated]];
}

describe('dashboard access (issue #13)', () => {
    beforeEach(() => {
        localStorage.clear();
        // The router's scrollBehavior; jsdom does not implement it.
        vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    });
    afterEach(() => localStorage.clear());

    it('gates the dashboard route on the management roles', async () => {
        const router = await freshRouter();
        const roles = router.resolve({ name: 'Dashboard' }).meta.roles;

        expect(roles).toEqual([...DASHBOARD_ROLES]);
        expect(roles).not.toContain(Role.Seller);
    });

    it('lands a SELLER-only cashier on the register', () => {
        expect(homeRouteFor([Role.Seller])).toEqual({
            name: 'SellerDashboard',
        });
    });

    it('lands every management role on the dashboard', () => {
        for (const role of DASHBOARD_ROLES) {
            expect(homeRouteFor([role])).toEqual({ name: 'Dashboard' });
        }
    });

    it.each(roleSets().map((roles) => [roles.join('+'), roles] as const))(
        'never lands %s on a page it may not open',
        (_label, roles) => {
            const home = homeRouteFor(roles);
            if (home.name === 'Dashboard') {
                expect(canViewDashboard(roles)).toBe(true);
            } else if (home.name === 'SellerDashboard') {
                expect(roles).toContain(Role.Seller);
            } else {
                // Login: only when no role opens any page.
                expect(roles).not.toContain(Role.Seller);
                expect(canViewDashboard(roles)).toBe(false);
            }
        },
    );

    it.each(NO_PAGE_SETS.map((roles) => [JSON.stringify(roles), roles]))(
        'sends a session with roles %s to Login once and ends it',
        async (_label, roles) => {
            for (const path of ['/', '/admin']) {
                post.mockClear();
                signIn(roles as Role[]);
                const router = await freshRouter();
                const settled = vi.fn();
                router.afterEach(settled);
                const { useAuthStore } = await import('@/stores/auth');

                await router.push(path);

                // Let logout() finish; its own push to Login is a no-op.
                await new Promise((resolve) => setTimeout(resolve, 0));

                expect(router.currentRoute.value.name).toBe('Login');
                // One completed navigation; logout's duplicate push to Login
                // settles as a failure without navigating. No loop.
                const completed = settled.mock.calls.filter(
                    ([, , failure]) => !failure,
                );
                expect(completed).toHaveLength(1);
                expect(settled.mock.calls.length).toBeLessThanOrEqual(2);
                expect(useAuthStore().user).toBeNull();
                expect(useAuthStore().isAuthenticated).toBe(false);
                expect(localStorage.getItem('user')).toBeNull();
                expect(post).toHaveBeenCalledWith('/auth/logout');
            }
        },
    );

    it('sends a SELLER-only cashier from / to the register', async () => {
        signIn([Role.Seller]);
        const router = await freshRouter();

        await router.push('/');

        expect(router.currentRoute.value.name).toBe('SellerDashboard');
    });

    it('turns a SELLER-only cashier away from the dashboard without looping', async () => {
        signIn([Role.Seller]);
        const router = await freshRouter();
        const guard = vi.fn();
        router.afterEach(guard);

        await router.push('/admin');

        expect(router.currentRoute.value.name).toBe('SellerDashboard');
        // One settled navigation, not a redirect chain back into /admin.
        expect(guard).toHaveBeenCalledTimes(1);
    });

    it('lets a restocker open the dashboard', async () => {
        signIn([Role.Restocker]);
        const router = await freshRouter();

        await router.push('/admin');

        expect(router.currentRoute.value.name).toBe('Dashboard');
    });

    it('sends a signed-in user who opens Login back to their home page', async () => {
        // Not while logging out (guard.spec.ts): then Login must show.
        signIn([Role.Seller]);
        const router = await freshRouter();

        await router.push({ name: 'Login' });

        expect(router.currentRoute.value.name).toBe('SellerDashboard');
    });

    it('says why a page was refused', async () => {
        signIn([Role.Restocker]);
        const router = await freshRouter();
        const { useUIStore } = await import('@/stores/ui');
        const queue = vi.spyOn(useUIStore(), 'queueMessage');

        await router.push('/admin/users');

        expect(router.currentRoute.value.name).toBe('Dashboard');
        expect(queue).toHaveBeenCalledWith(
            expect.anything(),
            'You do not have access to that page',
        );
    });

    it('sends an admin from / to the dashboard', async () => {
        signIn([Role.Admin]);
        const router = await freshRouter();

        await router.push('/');

        expect(router.currentRoute.value.name).toBe('Dashboard');
    });

    it('opens the Shifts page to an admin only (issue #2)', async () => {
        const router = await freshRouter();
        expect(router.resolve({ name: 'Shifts' }).meta.roles).toEqual([
            Role.Admin,
        ]);

        signIn([Role.Admin]);
        const asAdmin = await freshRouter();
        await asAdmin.push('/admin/shifts');
        expect(asAdmin.currentRoute.value.name).toBe('Shifts');

        signIn([Role.Seller, Role.UserManager]);
        const asManager = await freshRouter();
        await asManager.push('/admin/shifts');
        expect(asManager.currentRoute.value.name).not.toBe('Shifts');
    });

    it('drops the cart and shift when the session is found gone, without looping (#2)', async () => {
        localStorage.setItem(
            'user',
            JSON.stringify({ username: 'ana', roles: [Role.Seller] }),
        );
        // No session cookie: the session expired without a logout.
        Object.defineProperty(document, 'cookie', {
            configurable: true,
            get: () => '',
        });
        const router = await freshRouter();
        const { useCartStore } = await import('@/stores/cart');
        const { useShiftStore } = await import('@/stores/shift');
        const cart = useCartStore();
        const shift = useShiftStore();
        cart.add({ product: 'p1', EAN: '1', name: 'milk', unitPrice: 9500 });
        cart.lock();
        shift.loaded = true;
        shift.zRead = { shiftId: 's0' } as never;
        const guard = vi.fn();
        router.afterEach(guard);

        await router.push('/seller');

        expect(router.currentRoute.value.name).toBe('Login');
        expect(guard).toHaveBeenCalledTimes(1);
        expect(cart.items).toEqual([]);
        expect(cart.locked).toBe(false);
        expect(shift.zRead).toBeNull();
        expect(shift.loaded).toBe(false);
    });
});
