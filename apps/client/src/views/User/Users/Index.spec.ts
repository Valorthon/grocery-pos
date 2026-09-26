import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { Role, STRING_LIMITS } from '@grocery-pos/contracts';
import {
    check,
    click,
    field,
    fieldError,
    flush,
    type,
} from '@/testing/form-dom';
import { PASSWORD_HINT, REQUIRED } from '@/utils/rules';
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
        await check(Role.Seller, true);
        await click('Save');
    }

    it("shows the server's validation messages", async () => {
        api.post.mockRejectedValueOnce(
            httpError(400, {
                message: 'Validation failed',
                details: { messages: ['A user with this name already exists'] },
            }),
        );
        await createUser();

        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['A user with this name already exists'],
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

    it('cannot be closed while its save is in flight', async () => {
        let finish!: () => void;
        api.post.mockReturnValueOnce(
            new Promise((resolve) => {
                finish = () => resolve({ data: {} });
            }),
        );
        await createUser();
        const addTitle = () =>
            [...document.querySelectorAll('h2')].some(
                (h) => h.textContent === 'Add User',
            );

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        document.body
            .querySelector('.fixed.inset-0')!
            .dispatchEvent(new MouseEvent('mousedown'));
        await flush();
        expect(addTitle()).toBe(true);
        expect(document.body.style.overflow).toBe('hidden');
        const cancel = [...document.querySelectorAll('button')].find(
            (b) => b.textContent?.trim() === 'Cancel',
        )!;
        expect(cancel.disabled).toBe(true);

        finish();
        await flush();
        // Closed: BaseModal releases the page scroll at once (its leave
        // transition may keep the markup for a frame).
        expect(document.body.style.overflow).toBe('');
        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['User created'],
        ]);
    });

    it('no longer swallows an error that is not from axios', async () => {
        const bug = new TypeError('boom');
        api.post.mockRejectedValueOnce(bug);
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        await createUser();

        expect(log).toHaveBeenCalledWith(bug);

        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['Could not create the user.'],
        ]);
    });
});

describe('user editor (issue #20)', () => {
    const rowRoles = () =>
        document.querySelector('tbody tr')!.querySelectorAll('td')[1]!
            .textContent;

    it('Cancel leaves the row’s roles as they were', async () => {
        api.get.mockResolvedValue({ data: USERS });
        await mount();
        document
            .querySelector<HTMLButtonElement>('button[title="Edit"]')!
            .click();
        await flush();

        await check(Role.Restocker, true);
        await check(Role.Seller, false);
        await flush();
        expect(rowRoles()).toContain(Role.Seller);
        expect(rowRoles()).not.toContain(Role.Restocker);

        await click('Cancel');
        expect(rowRoles()).toContain(Role.Seller);
        expect(rowRoles()).not.toContain(Role.Restocker);

        // Reopened, the editor starts again from the row.
        document
            .querySelector<HTMLButtonElement>('button[title="Edit"]')!
            .click();
        await flush();
        const seller = [...document.querySelectorAll('label')]
            .filter((l) => l.textContent?.trim() === String(Role.Seller))
            .slice(-1)[0]!
            .querySelector('input')!;
        expect(seller.checked).toBe(true);
        expect(api.patch).not.toHaveBeenCalled();
    });

    it('blocks a blank create and says why for each field', async () => {
        api.get.mockResolvedValue({ data: USERS });
        await mount();
        await click('Add User');
        await type('Username', '   ');

        await click('Save');

        expect(api.post).not.toHaveBeenCalled();
        expect(fieldError('Username')).toBe(REQUIRED);
        expect(fieldError('Password')).toBe('Password is required');
        expect(
            document.querySelector('[data-testid="create-roles-error"]')
                ?.textContent,
        ).toContain('Pick at least one role');
    });

    it('blocks a short password', async () => {
        api.get.mockResolvedValue({ data: USERS });
        await mount();
        await click('Add User');
        await type('Username', 'bea');
        await type('Password', 'short');
        await check(Role.Seller, true);

        await click('Save');

        expect(api.post).not.toHaveBeenCalled();
        expect(fieldError('Password')).toBe(PASSWORD_HINT);
    });

    it('opens Add User empty after a Cancel', async () => {
        api.get.mockResolvedValue({ data: USERS });
        await mount();
        await click('Add User');
        await type('Username', 'bea');
        await click('Save');
        await click('Cancel');

        await click('Add User');

        expect(field('Username').value).toBe('');
        expect(fieldError('Username')).toBe('');
    });
});

describe('users search and create errors (issue #20 review)', () => {
    it('pages and retries with the last search, not unsearched text', async () => {
        api.get.mockResolvedValue({ data: { ...USERS, totalItems: 30 } });
        await mount();
        await type('Search Name', 'Ana');
        await click('Search');
        await type('Search Name', 'bob');
        api.get.mockClear();
        api.get.mockRejectedValueOnce(
            httpError(500, { message: 'Internal server error' }),
        );

        await click('Next');
        expect(tableError()).not.toBeNull();
        await click('Retry');

        expect(api.get.mock.calls.map(([, c]) => c.params)).toEqual([
            expect.objectContaining({ page: 2, name: 'ana' }),
            expect.objectContaining({ page: 2, name: 'ana' }),
        ]);
    });

    it('clears each Save error once its field is edited', async () => {
        api.get.mockResolvedValue({ data: USERS });
        await mount();
        await click('Add User');
        await click('Save');
        const rolesError = () =>
            document.querySelector('[data-testid="create-roles-error"]');
        expect(fieldError('Username')).toBe(REQUIRED);
        expect(fieldError('Password')).toBe('Password is required');
        expect(rolesError()).not.toBeNull();

        await type('Username', 'bea');
        expect(fieldError('Username')).toBe('');
        expect(fieldError('Password')).toBe('Password is required');

        await type('Password', 'long-enough-1');
        expect(fieldError('Password')).toBe('');

        await check(Role.Seller, true);
        expect(rolesError()).toBeNull();
    });

    it('checks the trimmed username length, as the API does', async () => {
        api.get.mockResolvedValue({ data: USERS });
        api.post.mockResolvedValueOnce({ data: {} });
        await mount();
        await click('Add User');
        // The limit inside spaces: the API trims, so this is accepted.
        await type('Username', `  ${'a'.repeat(STRING_LIMITS.USERNAME)}  `);
        await type('Password', 'long-enough-1');
        await check(Role.Seller, true);

        await click('Save');

        expect(fieldError('Username')).toBe('');
        expect(api.post).toHaveBeenCalledTimes(1);
    });
});
