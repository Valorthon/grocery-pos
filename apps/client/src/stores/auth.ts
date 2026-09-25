import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { isAxiosError } from 'axios';
import api from '@/axios';
import { useCartStore } from './cart';
import { useShiftStore } from './shift';
import { Color, useUIStore } from './ui';
import { hasSessionMarker } from '@/utils/session-cookie';

import { Role } from '@grocery-pos/contracts';

export { Role };

/** Mirrors GET /v1/users/profile exactly (apps/api/src/user/user.controller.ts). */
export interface User {
    username: string;
    roles: Role[];
}

export const useAuthStore = defineStore('auth', () => {
    const storedUser = localStorage.getItem('user');

    const initialUser: User | null =
        storedUser && storedUser !== 'undefined'
            ? (JSON.parse(storedUser) as User)
            : null;

    const user = ref<User | null>(initialUser);

    const hasSessionCookie = (): boolean => hasSessionMarker(document.cookie);

    const isAuthenticated = computed(() => !!user.value && hasSessionCookie());

    const login = async (
        username: string,
        password: string,
    ): Promise<unknown> => {
        const response = await api.post('/auth/login', { username, password });
        const data = response.data;
        // Immediately fetch full profile so roles are available
        await fetchMe();
        // A new session starts with a clean screen: nothing left over from
        // before (e.g. "Please log in to continue").
        useUIStore().clear();
        return data;
    };

    /**
     * Ends the session. `reason`, when given, is shown as an error on the
     * login page: it is queued after resetRegister clears the toasts.
     */
    const logout = async (reason?: string): Promise<void> => {
        try {
            await api.post('/auth/logout');
        } catch {
            // logout is best-effort; local state is cleared either way
        } finally {
            clearUser();
            resetRegister();
            if (reason) useUIStore().queueMessage(Color.ERROR, reason);
            const { default: router } = await import('@/router');
            await router.push({ name: 'Login' });
        }
    };

    /**
     * True while a user-initiated logout (`requestLogout`) is navigating to
     * Login: the router lets an authenticated user through to Login then,
     * and a draft page asks before discarding its drafts (issue #19).
     */
    const userLogoutPending = ref(false);

    /**
     * The Sign out button. Leaves the page first, so a page's leave guard
     * can ask (a draft page with unsaved drafts does); only once the
     * navigation to Login has gone through does the session end. "Stay"
     * cancels it: nothing is sent and the session goes on. Resolves true
     * when logged out.
     *
     * A forced end (the refresh failed, or the session is gone) calls
     * `logout` directly: the user is cleared before it navigates, so no
     * page asks and nothing can hold it up.
     */
    const requestLogout = async (): Promise<boolean> => {
        if (userLogoutPending.value) return false;
        const { default: router } = await import('@/router');
        userLogoutPending.value = true;
        try {
            await router.push({ name: 'Login' });
        } finally {
            userLogoutPending.value = false;
        }
        if (router.currentRoute.value.name !== 'Login') return false;
        await logout();
        return true;
    };

    /**
     * Forgets this browser's register state: the shift (and any Z-read on
     * screen) and the cart. Called whenever the session ends, on logout or
     * when the router finds it gone, so the next person at this register
     * never inherits the last cashier's basket or shift. The shift itself
     * stays open on the server; the same cashier resumes it at next login.
     * The toasts go too: the next person never sees the last one's errors.
     */
    const resetRegister = (): void => {
        useShiftStore().reset();
        useCartStore().reset();
        useUIStore().clear();
    };

    const clearUser = (): void => {
        user.value = null;
        localStorage.removeItem('user');
    };

    /**
     * Reloads the user (and so their roles) from the server. A 401 here
     * means the session is over (the axios interceptor already tried a
     * refresh), so the cached user is dropped. Any other failure (offline,
     * 5xx) keeps it: the session may well still be valid.
     */
    const fetchMe = async (): Promise<User | null> => {
        try {
            const response = await api.get('/users/profile');
            user.value = response.data;
            localStorage.setItem('user', JSON.stringify(user.value));
            return user.value;
        } catch (err) {
            if (isAxiosError(err) && err.response?.status === 401) clearUser();
            throw err;
        }
    };

    let sessionCheck: Promise<void> | null = null;

    /**
     * Once per page load: when a session cookie exists, re-reads the user
     * from the server so roles revoked (or granted) since the last visit
     * take effect instead of the copy in localStorage (issue #12). The
     * navigation guard awaits it before its first decision. Never rejects:
     * a 401 has already cleared the user, so the guard sends them to login.
     */
    const initSession = (): Promise<void> => {
        sessionCheck ??= (async () => {
            if (!hasSessionCookie()) return;
            try {
                await fetchMe();
            } catch {
                // Handled in fetchMe; the guard reads the resulting state.
            }
        })();
        return sessionCheck;
    };

    const hasRole = (role: Role): boolean => {
        return user.value?.roles?.includes(role) ?? false;
    };

    const isAdmin = computed(() => hasRole(Role.Admin));

    return {
        user,
        isAuthenticated,
        login,
        logout,
        requestLogout,
        userLogoutPending,
        resetRegister,
        fetchMe,
        initSession,
        hasRole,
        isAdmin,
    };
});
