/**
 * The profile menu's change-password dialog (#88), over the real router
 * and auth store, so a successful change is followed to the login page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, h, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { AxiosError, type AxiosResponse } from 'axios';
import { ErrorCode, Role, STRING_LIMITS } from '@grocery-pos/contracts';
import type { ApiGet, ApiSend } from '@/testing/api-mock';
import { click, field, fieldError, flush, type } from '@/testing/form-dom';
import { useAuthStore } from '@/stores/auth';
import { Color, useUIStore } from '@/stores/ui';
import { PASSWORD_HINT, PASSWORDS_DIFFER } from '@/utils/rules';
import ChangePasswordDialog from './ChangePasswordDialog.vue';
import {
    PASSWORD_CHANGED,
    PASSWORD_CHANGED_STAYED,
    WRONG_CURRENT_PASSWORD,
} from './change-password';

const api = vi.hoisted(() => ({
    get: vi.fn<ApiGet>(),
    post: vi.fn<ApiSend>(),
    patch: vi.fn<ApiSend>(),
}));
vi.mock('@/axios', () => ({ default: api }));
// Navigation only; the pages themselves are never rendered here.
vi.mock('@/views/Guest/Login.vue', () => ({ default: {} }));
vi.mock('@/layouts/GuestLayout.vue', () => ({ default: {} }));
vi.mock('@/layouts/UserLayout.vue', () => ({ default: {} }));
vi.mock('@/layouts/SellerLayout.vue', () => ({ default: {} }));
vi.mock('@/views/User/Dashboard.vue', () => ({ default: {} }));
vi.mock('@/views/User/Sales/SellerDashboard.vue', () => ({ default: {} }));

const { default: router } = await import('@/router');

const USER = { userId: 'u1', username: 'ana', roles: [Role.Seller] };

let app: App | null = null;
const open = ref(false);

function apiError(status: number, data: unknown): AxiosError {
    return new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, null, {
        status,
        data,
    } as AxiosResponse);
}

async function mount() {
    open.value = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(
        defineComponent({
            render: () =>
                h(ChangePasswordDialog, {
                    modelValue: open.value,
                    'onUpdate:modelValue': (value: boolean) => {
                        open.value = value;
                    },
                }),
        }),
    );
    app.use(router);
    app.mount(host);
    await flush();
}

const dialog = () => document.body.querySelector('[role="dialog"]');

async function fill(current: string, next: string, confirm = next) {
    await type('Current password', current);
    await type('New password', next);
    await type('Confirm new password', confirm);
}

const submit = () => click('Change password');

beforeEach(async () => {
    // The router scrolls to the top on navigation; jsdom has no scrollTo.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    localStorage.clear();
    localStorage.setItem('user', JSON.stringify(USER));
    Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => 'dummy=true',
    });
    setActivePinia(createPinia());
    api.get.mockReset().mockResolvedValue({ data: USER });
    api.post.mockReset().mockResolvedValue({ data: {} });
    api.patch.mockReset().mockResolvedValue({ data: '' });
    await router.push({ name: 'SellerDashboard' });
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

describe('ChangePasswordDialog (#88)', () => {
    it('has the three password fields, none of them trimmed or shown', async () => {
        await mount();

        for (const label of [
            'Current password',
            'New password',
            'Confirm new password',
        ]) {
            expect(field(label).type).toBe('password');
        }
        expect(field('Current password').autocomplete).toBe('current-password');
        expect(field('New password').autocomplete).toBe('new-password');
    });

    it('checks every field on submit and sends nothing while one is refused', async () => {
        await mount();

        await submit();

        expect(fieldError('Current password')).not.toBe('');
        expect(fieldError('New password')).not.toBe('');
        expect(fieldError('Confirm new password')).not.toBe('');
        expect(api.patch).not.toHaveBeenCalled();

        await fill('x'.repeat(STRING_LIMITS.PASSWORD + 1), 'short', 'shorts');
        await submit();

        expect(fieldError('Current password')).toBe(
            `At most ${STRING_LIMITS.PASSWORD} characters`,
        );
        expect(fieldError('New password')).toBe(PASSWORD_HINT);
        expect(fieldError('Confirm new password')).toBe(PASSWORDS_DIFFER);
        expect(api.patch).not.toHaveBeenCalled();
    });

    it("clears a field's error once it is edited", async () => {
        await mount();
        await submit();

        await type('New password', 'x');

        expect(fieldError('New password')).toBe('');
        expect(fieldError('Current password')).not.toBe('');
    });

    it('sends exactly the current and new password, untrimmed', async () => {
        await mount();
        await fill(' old ', ' new-secret ');

        await submit();

        expect(api.patch.mock.calls).toEqual([
            [
                '/users/me/password',
                { currentPassword: ' old ', newPassword: ' new-secret ' },
            ],
        ]);
    });

    it('shows a wrong current password on its field, and stays logged in', async () => {
        await mount();
        await fill('guess', 'new-secret');
        api.patch.mockRejectedValue(
            apiError(403, {
                statusCode: 403,
                error: ErrorCode.USER_WRONG_PASSWORD,
                message: 'Current password is incorrect',
            }),
        );

        await submit();

        expect(fieldError('Current password')).toBe(WRONG_CURRENT_PASSWORD);
        expect(dialog()).not.toBeNull();
        expect(useUIStore().toasts).toEqual([]);
        expect(api.post).not.toHaveBeenCalled();
        expect(useAuthStore().user).not.toBeNull();
    });

    it('shows any other failure as an error toast, with the dialog still open', async () => {
        await mount();
        await fill('secret', 'new-secret');
        api.patch.mockRejectedValue(
            apiError(429, {
                statusCode: 429,
                error: ErrorCode.RATE_LIMITED,
                message: 'Too many attempts. Try again in 60 seconds.',
            }),
        );

        await submit();

        const toasts = useUIStore().toasts;
        expect(toasts.map((t) => [t.color, t.lines])).toEqual([
            [Color.ERROR, ['Too many attempts. Try again in 60 seconds.']],
        ]);
        expect(fieldError('Current password')).toBe('');
        expect(dialog()).not.toBeNull();
        expect(router.currentRoute.value.name).toBe('SellerDashboard');
    });

    it('stays open until the save resolves', async () => {
        await mount();
        await fill('secret', 'new-secret');
        let answer!: (value: { data: unknown }) => void;
        api.patch.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            }),
        );

        await submit();
        await click('Cancel');
        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await flush();

        expect(open.value).toBe(true);
        expect(dialog()).not.toBeNull();
        expect(api.patch).toHaveBeenCalledTimes(1);

        answer({ data: '' });
        await flush();

        expect(open.value).toBe(false);
    });

    it('on success logs out to the login page, with a success notice and no session-expired error', async () => {
        await mount();
        await fill('secret', 'new-secret');

        await submit();
        await flush();

        expect(open.value).toBe(false);
        expect(api.post.mock.calls).toEqual([['/auth/logout']]);
        expect(useAuthStore().user).toBeNull();
        expect(router.currentRoute.value.name).toBe('Login');
        expect(useUIStore().toasts.map((t) => [t.color, t.lines])).toEqual([
            [Color.SUCCESS, [PASSWORD_CHANGED]],
        ]);
    });

    it('keeps the session when a draft page is told "Stay", and says what to do', async () => {
        await mount();
        await fill('secret', 'new-secret');
        const auth = useAuthStore();
        const requestLogout = vi
            .spyOn(auth, 'requestLogout')
            .mockResolvedValue(false);

        await submit();

        expect(requestLogout).toHaveBeenCalledWith(PASSWORD_CHANGED);
        expect(useUIStore().toasts.map((t) => [t.color, t.lines])).toEqual([
            [Color.SUCCESS, [PASSWORD_CHANGED_STAYED]],
        ]);
    });

    it('starts empty each time it opens', async () => {
        await mount();
        await fill('secret', 'new');
        await submit();

        open.value = false;
        await flush();
        open.value = true;
        await flush();

        expect(field('Current password').value).toBe('');
        expect(field('New password').value).toBe('');
        expect(fieldError('New password')).toBe('');
    });
});
