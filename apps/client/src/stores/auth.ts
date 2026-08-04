import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '@/axios';
import router from '@/router';

export enum Role {
    Seller = 'SELLER',
    Adjuster = 'ADJUSTER',
    Restocker = 'RESTOCKER',
    UserManager = 'USER_MANAGER',
    Admin = 'ADMIN',
    Unauthenticated = 'UNAUTHENTICATED',
}

export interface User {
    id?: number;
    username?: string;
    email?: string;
    name?: string;
    roles?: Role[];
    [key: string]: unknown;
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
        console.log({ data });
        // Immediately fetch full profile so roles are available
        await fetchMe();
        return data;
    };

    const logout = async (): Promise<void> => {
        try {
            await api.post('/auth/logout');
        } catch (e) {
            console.log(e);
            // silent fail - still clear local state
        } finally {
            user.value = null;
            localStorage.removeItem('user');
            router.push({ name: 'Login' });
        }
    };

    const fetchMe = async (): Promise<User | null> => {
        try {
            const response = await api.get('/users/profile');
            user.value = response.data;
            console.log(user.value);
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
