import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { isAxiosError } from 'axios';
import api from '@/axios';
import { USER_STORAGE_KEY, useCartStore } from './cart';
import { useShiftStore } from './shift';
import { Color, useUIStore } from './ui';
import { hasSessionMarker } from '@/utils/session-cookie';

import {
    type LoginResponse,
    type ProfileView,
    Role,
} from '@grocery-pos/contracts';

export { Role };

/**
 * The logged-in user: `GET /v1/users/profile` (contracts `ProfileView`),
 * cached in localStorage.
 */
export interface User extends Omit<ProfileView, 'userId'> {
    /**
     * The account's id; keys this cashier's saved basket (#23). Absent on a
     * user cached before it was sent, until the profile is re-read.
     */
    userId?: string;
}

export const useAuthStore = defineStore('auth', () => {
    const storedUser = localStorage.getItem(USER_STORAGE_KEY);

    const initialUser: User | null =
        storedUser && storedUser !== 'undefined'
            ? (JSON.parse(storedUser) as User)
            : null;

    const user = ref<User | null>(initialUser);
    // Restores this cashier's saved basket, if any (#23).
    useCartStore().setOwner(initialUser?.userId);

    const hasSessionCookie = (): boolean => hasSessionMarker(document.cookie);

    const isAuthenticated = computed(() => !!user.value && hasSessionCookie());

    const login = async (
        username: string,
        password: string,
    ): Promise<LoginResponse> => {
        const response = await api.post<LoginResponse>('/auth/login', {
            username,
            password,
        });
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
     * The Log out button. Leaves the page first, so a page's leave guard
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
     * The basket saved in this browser for the cashier goes as well (#23).
     */
    const resetRegister = (): void => {
        useShiftStore().reset();
        useCartStore().reset();
        useUIStore().clear();
    };

    const clearUser = (): void => {
        user.value = null;
        localStorage.removeItem(USER_STORAGE_KEY);
    };

    /**
     * Reloads the user (and so their roles) from the server. A 401 here
     * means the session is over (the axios interceptor already tried a
     * refresh), so the cached user is dropped. Any other failure (offline,
     * 5xx) keeps it: the session may well still be valid.
     */
    const fetchMe = async (): Promise<User | null> => {
        try {
            const response = await api.get<ProfileView>('/users/profile');
            user.value = response.data;
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user.value));
            useCartStore().setOwner(user.value?.userId);
            return user.value;
        } catch (err) {
            if (isAxiosError(err) && err.response?.status === 401) clearUser();
            throw err;
        }
    };

    let sessionCheck: Promise<void> | null = null;

    /**
     * The session ended while the app was closed (#23 review): the cached
     * user's cookie is gone, or the profile answered 401. Treated as a
     * forced logout, locally: the cached user, the shift and that
     * cashier's saved basket go, as if the logout had happened then. The
     * guard does not see it on a public page (e.g. `/` or Login), so it
     * cannot be left to the guard's own reset.
     */
    const endStaleSession = (): void => {
        if (!user.value && !useCartStore().owner) return;
        clearUser();
        resetRegister();
    };

    /**
     * Once per page load: when a session cookie exists, re-reads the user
     * from the server so roles revoked (or granted) since the last visit
     * take effect instead of the copy in localStorage (issue #12). Without
     * a session (no cookie, or a 401) whatever the last session left is
     * dropped (`endStaleSession`). The navigation guard awaits it before
     * its first decision. Never rejects.
     */
    const initSession = (): Promise<void> => {
        sessionCheck ??= (async () => {
            if (!hasSessionCookie()) {
                endStaleSession();
                return;
            }
            try {
                await fetchMe();
            } catch (err) {
                // Any other failure (offline, 5xx) keeps the session.
                if (isAxiosError(err) && err.response?.status === 401) {
                    endStaleSession();
                }
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
