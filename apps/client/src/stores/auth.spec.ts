import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { Role } from '@grocery-pos/contracts';
import { AxiosError, type AxiosResponse } from 'axios';

vi.mock('@/axios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

/** The API marks sessions with a readable `dummy` cookie alongside httpOnly ones. */
function setDummyCookie(present: boolean) {
    Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => (present ? 'dummy=true' : ''),
    });
}

async function loadStore() {
    vi.resetModules();
    const { useAuthStore } = await import('./auth');
    return useAuthStore();
}

describe('auth store', () => {
    beforeEach(() => {
        localStorage.clear();
        setActivePinia(createPinia());
        setDummyCookie(false);
    });

    it('rehydrates the user from localStorage', async () => {
        localStorage.setItem(
            'user',
            JSON.stringify({ username: 'admin', roles: [Role.Admin] }),
        );

        const store = await loadStore();

        expect(store.user).toEqual({ username: 'admin', roles: [Role.Admin] });
    });

    it("tolerates the literal string 'undefined' in storage", async () => {
        // A previous bug wrote the string "undefined"; JSON.parse would throw
        // and take the whole app down at store creation.
        localStorage.setItem('user', 'undefined');

        const store = await loadStore();

        expect(store.user).toBeNull();
    });

    it('is not authenticated with a stored user but no session cookie', async () => {
        localStorage.setItem(
            'user',
            JSON.stringify({ username: 'seller', roles: [Role.Seller] }),
        );

        const store = await loadStore();

        expect(store.isAuthenticated).toBe(false);
    });

    it('is authenticated with both a stored user and the session cookie', async () => {
        localStorage.setItem(
            'user',
            JSON.stringify({ username: 'seller', roles: [Role.Seller] }),
        );
        setDummyCookie(true);

        const store = await loadStore();

        expect(store.isAuthenticated).toBe(true);
    });

    it('is not authenticated with the cookie but no user', async () => {
        setDummyCookie(true);

        const store = await loadStore();

        expect(store.isAuthenticated).toBe(false);
    });

    // NOTE: isAuthenticated is a computed that reads document.cookie, which is
    // not a reactive source. It therefore only re-evaluates when `user` changes,
    // not when the cookie itself expires or is cleared. Each case above uses a
    // freshly created store so it observes the real initial evaluation.
    it('does not observe a cookie change on its own', async () => {
        localStorage.setItem(
            'user',
            JSON.stringify({ username: 'seller', roles: [Role.Seller] }),
        );

        const store = await loadStore();
        expect(store.isAuthenticated).toBe(false);

        setDummyCookie(true);

        expect(store.isAuthenticated).toBe(false);
    });

    describe('roles', () => {
        it('reports only the roles the user actually holds', async () => {
            localStorage.setItem(
                'user',
                JSON.stringify({ username: 'seller', roles: [Role.Seller] }),
            );

            const store = await loadStore();

            expect(store.hasRole(Role.Seller)).toBe(true);
            expect(store.hasRole(Role.UserManager)).toBe(false);
            expect(store.isAdmin).toBe(false);
        });

        it('does not treat a role as held when there is no user', async () => {
            const store = await loadStore();

            expect(store.hasRole(Role.Admin)).toBe(false);
            expect(store.isAdmin).toBe(false);
        });

        it('recognises an admin', async () => {
            localStorage.setItem(
                'user',
                JSON.stringify({ username: 'admin', roles: [Role.Admin] }),
            );

            const store = await loadStore();

            expect(store.isAdmin).toBe(true);
        });
    });

    it('clears user state on logout even when the request fails', async () => {
        localStorage.setItem(
            'user',
            JSON.stringify({ username: 'admin', roles: [Role.Admin] }),
        );
        const api = (await import('@/axios')).default;
        vi.mocked(api.post).mockRejectedValue(new Error('network down'));

        const store = await loadStore();
        await store.logout();

        expect(store.user).toBeNull();
        expect(localStorage.getItem('user')).toBeNull();
    });

    describe('initSession (roles freshness, #12)', () => {
        const staleAdmin = { username: 'admin', roles: [Role.Admin] };

        function httpError(status: number) {
            return new AxiosError(
                'failed',
                'ERR_BAD_REQUEST',
                undefined,
                null,
                {
                    status,
                } as AxiosResponse,
            );
        }

        async function setup(profile: () => Promise<unknown>) {
            localStorage.setItem('user', JSON.stringify(staleAdmin));
            const api = (await import('@/axios')).default;
            vi.mocked(api.get).mockImplementation(profile as never);
            const store = await loadStore();
            return { api, store };
        }

        it('re-reads the user from the server when a session exists', async () => {
            setDummyCookie(true);
            const { api, store } = await setup(async () => ({
                data: { username: 'admin', roles: [Role.Seller] },
            }));

            await store.initSession();

            expect(api.get).toHaveBeenCalledWith('/users/profile');
            expect(store.isAdmin).toBe(false);
            expect(store.hasRole(Role.Seller)).toBe(true);
            expect(JSON.parse(localStorage.getItem('user')!)).toEqual({
                username: 'admin',
                roles: [Role.Seller],
            });
        });

        it('fetches only once per page load', async () => {
            setDummyCookie(true);
            const { api, store } = await setup(async () => ({
                data: staleAdmin,
            }));

            await Promise.all([store.initSession(), store.initSession()]);
            await store.initSession();

            expect(api.get).toHaveBeenCalledTimes(1);
        });

        it('does nothing without a session cookie', async () => {
            const { api, store } = await setup(async () => ({ data: {} }));

            await store.initSession();

            expect(api.get).not.toHaveBeenCalled();
        });

        it('drops the user on a 401 (session over) and still resolves', async () => {
            setDummyCookie(true);
            const { store } = await setup(() => Promise.reject(httpError(401)));

            await expect(store.initSession()).resolves.toBeUndefined();

            expect(store.user).toBeNull();
            expect(store.isAuthenticated).toBe(false);
            expect(localStorage.getItem('user')).toBeNull();
        });

        it('keeps the cached user when the server is unreachable', async () => {
            setDummyCookie(true);
            const { store } = await setup(() => Promise.reject(httpError(503)));

            await store.initSession();

            expect(store.user).toEqual(staleAdmin);
        });
    });
});
