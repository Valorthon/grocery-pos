import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { ASSIGNABLE_ROLES, Role } from '@grocery-pos/contracts';
import { canViewDashboard, DASHBOARD_ROLES, homeRouteFor } from './access';

vi.mock('@/axios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

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

/** Every non-empty combination of assignable roles. */
function roleSets(): Role[][] {
    const roles = [...ASSIGNABLE_ROLES];
    const sets: Role[][] = [];
    for (let mask = 1; mask < 1 << roles.length; mask++) {
        sets.push(roles.filter((_, i) => mask & (1 << i)));
    }
    return sets;
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
            } else {
                expect(roles).toContain(Role.Seller);
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

    it('sends an admin from / to the dashboard', async () => {
        signIn([Role.Admin]);
        const router = await freshRouter();

        await router.push('/');

        expect(router.currentRoute.value.name).toBe('Dashboard');
    });
});
