import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '@/axios';

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

    const isAuthenticated = computed(
        () =>
            !!user.value &&
            document.cookie.split('; ').some((row) => row.startsWith('dummy')),
    );

    const login = async (
        username: string,
        password: string,
    ): Promise<unknown> => {
        const response = await api.post('/auth/login', { username, password });
        const data = response.data;
        // Immediately fetch full profile so roles are available
        await fetchMe();
        return data;
    };

    const logout = async (): Promise<void> => {
        try {
            await api.post('/auth/logout');
        } catch {
            // logout is best-effort; local state is cleared either way
        } finally {
            user.value = null;
            localStorage.removeItem('user');
            const { default: router } = await import('@/router');
            router.push({ name: 'Login' });
        }
    };

    const fetchMe = async (): Promise<User | null> => {
        try {
            const response = await api.get('/users/profile');
            user.value = response.data;
            localStorage.setItem('user', JSON.stringify(user.value));
            return user.value;
        } catch (err) {
            user.value = null;
            localStorage.removeItem('user');
            throw err;
        }
    };

    const hasRole = (role: Role): boolean => {
        return user.value?.roles?.includes(role) ?? false;
    };

    const isAdmin = computed(() => hasRole(Role.Admin));

    return { user, isAuthenticated, login, logout, fetchMe, hasRole, isAdmin };
});
