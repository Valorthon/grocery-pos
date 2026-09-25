import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { Role } from '@grocery-pos/contracts';
import { click, flush, type } from '@/testing/form-dom';
import { useAuthStore } from '@/stores/auth';
import { useUIStore } from '@/stores/ui';
import Index from './Index.vue';

const api = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
}));
vi.mock('@/axios', () => ({ default: api }));

function httpError(status: number, body: object): AxiosError {
    const config = { headers: new AxiosHeaders() };
    return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, {
        status,
        statusText: '',
        headers: {},
        config,
        data: { statusCode: status, ...body },
    } as AxiosResponse);
}

const USERS = {
    data: [{ _id: 'u1', name: 'ana', roles: [Role.Seller], isActive: true }],
    totalItems: 1,
};

let app: App | null = null;
let pinia: Pinia;

beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    api.get.mockReset();
    api.post.mockReset();
    api.patch.mockReset();
    useAuthStore().user = { username: 'boss', roles: [Role.Admin] };
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Index);
    app.use(pinia);
    app.mount(host);
    await flush();
    return host;
}

const tableError = () =>
    document.querySelector<HTMLElement>('[data-testid="table-error"]');

describe('users list (issue #18)', () => {
    it('shows the failure in the table and ends loading', async () => {
        api.get.mockRejectedValueOnce(
            httpError(500, { message: 'Internal server error' }),
        );
        await mount();

        expect(tableError()?.getAttribute('role')).toBe('alert');
        expect(tableError()?.textContent).toContain('Internal server error');
        expect(document.querySelector('.animate-pulse')).toBeNull();
    });

    it('loads the list again from Retry', async () => {
        api.get
            .mockRejectedValueOnce(
                new AxiosError('Network Error', 'ERR_NETWORK', {
                    headers: new AxiosHeaders(),
                }),
            )
            .mockResolvedValueOnce({ data: USERS });
        const host = await mount();
        expect(tableError()?.textContent).toContain(
            'Could not reach the server',
        );

        await click('Retry');

        expect(api.get).toHaveBeenCalledTimes(2);
        expect(tableError()).toBeNull();
        expect(host.textContent).toContain('ana');
    });
});

describe('users save errors (issue #18)', () => {
    async function createUser() {
        api.get.mockResolvedValue({ data: USERS });
        await mount();
        await click('Add User');
        await type('Username', 'bea');
        await type('Password', 'long-enough-1');
        await click('Save');
    }

    it("shows the server's validation messages", async () => {
        api.post.mockRejectedValueOnce(
            httpError(400, {
                message: 'Validation failed',
                details: { messages: ['users.0.roles should not be empty'] },
            }),
        );
        await createUser();

        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['users.0.roles should not be empty'],
        ]);
        // The dialog stays open with what was typed.
        expect(
            [...document.querySelectorAll('h2')].map((h) => h.textContent),
        ).toContain('Add User');
    });

    it('shows the server message of a failed update', async () => {
        api.get.mockResolvedValue({ data: USERS });
        api.patch.mockRejectedValueOnce(
            httpError(403, { message: 'You cannot manage this user' }),
        );
        await mount();
        document
            .querySelector<HTMLButtonElement>('button[title="Edit"]')!
            .click();
        await flush();

        await click('Save');

        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['You cannot manage this user'],
        ]);
    });

    it('no longer swallows an error that is not from axios', async () => {
        api.post.mockRejectedValueOnce(new TypeError('boom'));
        await createUser();

        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['Could not create the user.'],
        ]);
    });
});
