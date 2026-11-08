/**
 * Unknown paths show a not-found page instead of Login (#162); known
 * protected routes still send a logged-out visitor to Login.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { Role } from '@grocery-pos/contracts';

vi.mock('@/axios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));
const stub = { default: defineComponent({ render: () => null }) };
vi.mock('@/layouts/GuestLayout.vue', () => stub);
vi.mock('@/layouts/SellerLayout.vue', () => stub);
vi.mock('@/layouts/UserLayout.vue', () => stub);
vi.mock('@/views/Guest/Login.vue', () => stub);
vi.mock('@/views/NotFound.vue', () => stub);
vi.mock('@/views/User/Sales/SellerDashboard.vue', () => stub);
vi.mock('@/views/User/Dashboard.vue', () => stub);
vi.mock('@/views/User/Users/Index.vue', () => stub);

function setCookie(present: boolean) {
    Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => (present ? 'dummy=true' : ''),
    });
}

async function freshRouter(roles: Role[] | null) {
    vi.resetModules();
    setActivePinia(createPinia());
    if (roles) {
        localStorage.setItem('user', JSON.stringify({ username: 'u', roles }));
    }
    setCookie(roles !== null);
    const api = (await import('@/axios')).default;
    vi.mocked(api.get).mockResolvedValue({
        data: { username: 'u', roles: roles ?? [] },
    });
    const { default: router } = await import('./index');
    return router;
}

describe('not-found route (#162)', () => {
    beforeEach(() => {
        localStorage.clear();
        document.title = 'Grocery POS';
        vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    });
    afterEach(() => localStorage.clear());

    it.each(['/nope', '/admin/nope', '/seller/nope/deeper'])(
        'shows the not-found page for %s when logged out',
        async (path) => {
            const router = await freshRouter(null);
            await router.push(path);
            expect(router.currentRoute.value.name).toBe('NotFound');
            expect(router.currentRoute.value.fullPath).toBe(path);
            expect(document.title).toBe('Page not found | Grocery POS');
        },
    );

    it('still sends a logged-out visitor on a protected route to Login', async () => {
        const router = await freshRouter(null);
        await router.push('/admin/users');
        expect(router.currentRoute.value.name).toBe('Login');
        expect(document.title).toBe('Grocery POS');
    });

    it.each([[[Role.Admin]], [[Role.Seller]]])(
        'shows the not-found page to a logged-in %j user',
        async (roles) => {
            const router = await freshRouter(roles);
            await router.push('/admin/does-not-exist');
            expect(router.currentRoute.value.name).toBe('NotFound');
        },
    );

    it('restores the base title when leaving the page', async () => {
        const router = await freshRouter([Role.Admin]);
        await router.push('/nope');
        expect(document.title).toBe('Page not found | Grocery POS');
        await router.push('/admin');
        expect(router.currentRoute.value.name).toBe('Dashboard');
        expect(document.title).toBe('Grocery POS');
    });
});
