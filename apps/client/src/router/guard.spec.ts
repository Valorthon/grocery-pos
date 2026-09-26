/**
 * The navigation guard waits for the start-up profile fetch, so it decides
 * on the server's current roles rather than the localStorage copy (#12).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { AxiosError, type AxiosResponse } from 'axios';
import { Role } from '@grocery-pos/contracts';

vi.mock('@/axios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));
// The views themselves are irrelevant here; keep navigation from loading them.
vi.mock('@/views/Guest/Login.vue', () => ({ default: {} }));
vi.mock('@/layouts/GuestLayout.vue', () => ({ default: {} }));
vi.mock('@/layouts/UserLayout.vue', () => ({ default: {} }));
vi.mock('@/layouts/SellerLayout.vue', () => ({ default: {} }));
vi.mock('@/views/User/Dashboard.vue', () => ({ default: {} }));
vi.mock('@/views/User/Users/Index.vue', () => ({ default: {} }));
vi.mock('@/views/User/Sales/SellerDashboard.vue', () => ({ default: {} }));

function setDummyCookie(present: boolean) {
    Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => (present ? 'dummy=true' : ''),
    });
}

async function boot(profile: () => Promise<unknown>) {
    vi.resetModules();
    setActivePinia(createPinia());
    const api = (await import('@/axios')).default;
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockImplementation(profile as never);
    vi.mocked(api.post).mockResolvedValue({});
    const { default: router } = await import('@/router');
    return { api, router };
}

describe('router guard and the start-up profile fetch', () => {
    beforeEach(() => {
        localStorage.clear();
        // A stale copy that still claims ADMIN.
        localStorage.setItem(
            'user',
            JSON.stringify({ username: 'boss', roles: [Role.Admin] }),
        );
        setDummyCookie(true);
    });

    it('applies roles revoked since the last visit before the first navigation', async () => {
        const { api, router } = await boot(async () => ({
            data: { username: 'boss', roles: [Role.Seller] },
        }));

        await router.push('/admin/users');

        expect(api.get).toHaveBeenCalledWith('/users/profile');
        expect(router.currentRoute.value.name).toBe('SellerDashboard');
    });

    it('lets a user who still holds the role through', async () => {
        const { router } = await boot(async () => ({
            data: { username: 'boss', roles: [Role.Admin] },
        }));

        await router.push('/admin/users');

        expect(router.currentRoute.value.name).toBe('Users');
    });

    it('sends an expired session to login once, without looping', async () => {
        const { api, router } = await boot(() =>
            Promise.reject(
                new AxiosError('401', 'ERR_BAD_REQUEST', undefined, null, {
                    status: 401,
                } as AxiosResponse),
            ),
        );

        await router.push('/admin/users');
        expect(router.currentRoute.value.name).toBe('Login');

        // Further navigations reuse the settled check: no refetch, no loop.
        await router.push('/admin');
        expect(router.currentRoute.value.name).toBe('Login');
        expect(api.get).toHaveBeenCalledTimes(1);
        // The login prompt shows once, with no repeat count (#18).
        const { useUIStore } = await import('@/stores/ui');
        const toasts = useUIStore().toasts;
        expect(toasts.map((t) => [t.lines, t.count])).toEqual([
            [['Please log in to continue'], 1],
        ]);
    });

    it('does not fetch without a session cookie', async () => {
        setDummyCookie(false);
        const { api, router } = await boot(async () => ({ data: {} }));

        await router.push('/admin/users');

        expect(api.get).not.toHaveBeenCalled();
        expect(router.currentRoute.value.name).toBe('Login');
    });

    it('lets Log out through to Login, and only then ends the session (#19)', async () => {
        const { api, router } = await boot(async () => ({
            data: { username: 'boss', roles: [Role.Admin] },
        }));
        await router.push('/admin/users');

        // A signed-in user who merely visits Login is sent home.
        await router.push({ name: 'Login' });
        expect(router.currentRoute.value.name).toBe('Dashboard');
        expect(api.post).not.toHaveBeenCalled();

        const { useAuthStore } = await import('@/stores/auth');
        const auth = useAuthStore();
        expect(await auth.requestLogout()).toBe(true);

        expect(router.currentRoute.value.name).toBe('Login');
        expect(vi.mocked(api.post).mock.calls).toEqual([['/auth/logout']]);
        expect(auth.user).toBeNull();
        expect(auth.userLogoutPending).toBe(false);
    });
});
