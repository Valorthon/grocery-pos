import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { ErrorCode, Role, STRING_LIMITS } from '@grocery-pos/contracts';
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
import type { ApiGet, ApiSend } from '@/testing/api-mock';

const api = vi.hoisted(() => ({
    get: vi.fn<ApiGet>(),
    post: vi.fn<ApiSend>(),
    patch: vi.fn<ApiSend>(),
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

        expect(api.get.mock.calls.map(([, c]) => c?.params)).toEqual([
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

describe('own account (issue #61)', () => {
    const ROWS = {
        data: [
            {
                _id: 'm1',
                name: 'boss',
                roles: [Role.UserManager],
                isActive: true,
            },
            { _id: 'u1', name: 'ana', roles: [Role.Seller], isActive: true },
        ],
        totalItems: 2,
    };

    async function editRow(name: string) {
        const row = [...document.querySelectorAll('tbody tr')].find((tr) =>
            tr.textContent?.includes(name),
        )!;
        row.querySelector<HTMLButtonElement>('button[title="Edit"]')!.click();
        await flush();
    }

    const activeBox = () =>
        [...document.querySelectorAll('label')]
            .find((l) => l.textContent?.trim() === 'Active')!
            .querySelector('input')!;
    const hint = () =>
        document.querySelector('[data-testid="self-active-hint"]');

    it("disables a manager's own Active toggle", async () => {
        useAuthStore().user = { username: 'boss', roles: [Role.UserManager] };
        api.get.mockResolvedValue({ data: ROWS });
        api.patch.mockResolvedValueOnce({ data: {} });
        await mount();

        await editRow('boss');

        expect(activeBox().disabled).toBe(true);
        expect(activeBox().checked).toBe(true);
        expect(hint()?.textContent).toContain(
            "You can't deactivate your own account.",
        );

        await click('Save');
        expect(api.patch).toHaveBeenCalledWith('/users', {
            updates: [{ user: 'm1', update: { isActive: true } }],
        });
    });

    it('finds the own row by id when the username is stale', async () => {
        // Renamed since the profile was cached: the id still matches.
        useAuthStore().user = {
            userId: 'm1',
            username: 'old-boss',
            roles: [Role.UserManager],
        };
        api.get.mockResolvedValue({ data: ROWS });
        await mount();

        await editRow('boss');
        expect(activeBox().disabled).toBe(true);
        expect(hint()).not.toBeNull();
    });

    it('does not take a same-named row with another id for the own row', async () => {
        // A cashier now holds the name the manager's cached profile has.
        useAuthStore().user = {
            userId: 'm1',
            username: 'boss',
            roles: [Role.UserManager],
        };
        api.get.mockResolvedValue({
            data: {
                data: [
                    {
                        _id: 'u2',
                        name: 'boss',
                        roles: [Role.Seller],
                        isActive: true,
                    },
                ],
                totalItems: 1,
            },
        });
        await mount();

        await editRow('boss');
        expect(activeBox().disabled).toBe(false);
        expect(hint()).toBeNull();
    });

    it("leaves a manager's toggle on a cashier's row enabled", async () => {
        useAuthStore().user = { username: 'boss', roles: [Role.UserManager] };
        api.get.mockResolvedValue({ data: ROWS });
        await mount();

        await editRow('ana');

        expect(activeBox().disabled).toBe(false);
        expect(hint()).toBeNull();
    });

    it('leaves an admin their own toggle (the server keeps one admin)', async () => {
        useAuthStore().user = { username: 'root', roles: [Role.Admin] };
        api.get.mockResolvedValue({
            data: {
                data: [
                    {
                        _id: 'a1',
                        name: 'root',
                        roles: [Role.Admin],
                        isActive: true,
                    },
                ],
                totalItems: 1,
            },
        });
        await mount();

        await editRow('root');

        expect(activeBox().disabled).toBe(false);
        expect(hint()).toBeNull();
    });
});

describe('renaming users (issue #106)', () => {
    const ROWS = {
        data: [
            {
                _id: 'm1',
                name: 'boss',
                roles: [Role.UserManager],
                isActive: true,
            },
            { _id: 'u1', name: 'ana', roles: [Role.Seller], isActive: true },
            { _id: 'a1', name: 'root', roles: [Role.Admin], isActive: true },
        ],
        totalItems: 3,
    };

    async function editRow(name: string) {
        const row = [...document.querySelectorAll('tbody tr')].find((tr) =>
            tr.textContent?.includes(name),
        )!;
        row.querySelector<HTMLButtonElement>('button[title="Edit"]')!.click();
        await flush();
    }

    const dialogTitles = () =>
        [...document.querySelectorAll('h2')].map((h) => h.textContent);
    const confirmText = () =>
        [...document.querySelectorAll('[role="dialog"]')]
            .find((d) => d.textContent?.includes('will log in as'))
            ?.querySelector('p')?.textContent;

    /** Clicks the edit dialog's Save (the confirm has no Save). */
    const save = () => click('Save');

    /** Answers the rename confirmation. */
    async function answer(label: 'Rename' | 'Cancel') {
        const dialog = [...document.querySelectorAll('[role="dialog"]')].find(
            (d) => d.textContent?.includes('will log in as'),
        )!;
        [...dialog.querySelectorAll('button')]
            .find((b) => b.textContent?.trim() === label)!
            .click();
        await flush();
    }

    it('lets an admin rename a user after confirming the new login name', async () => {
        api.get.mockResolvedValue({ data: ROWS });
        api.patch.mockResolvedValueOnce({ data: {} });
        await mount();
        await editRow('ana');

        expect(field('Username').disabled).toBe(false);
        await type('Username', '  Bea ');
        await save();

        expect(api.patch).not.toHaveBeenCalled();
        expect(dialogTitles()).toContain('Rename this user?');
        expect(confirmText()).toBe('ana becomes bea. They will log in as bea.');

        await answer('Rename');

        expect(api.patch).toHaveBeenCalledWith('/users', {
            updates: [
                {
                    user: 'u1',
                    update: {
                        isActive: true,
                        roles: [Role.Seller],
                        name: 'bea',
                    },
                },
            ],
        });
        // Someone else's rename leaves the signed-in user as they were.
        expect(useAuthStore().user?.username).toBe('boss');
        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['User updated'],
        ]);
    });

    it('keeps the dialog and the typed name when the rename is cancelled', async () => {
        api.get.mockResolvedValue({ data: ROWS });
        await mount();
        await editRow('ana');
        await type('Username', 'bea');
        await save();

        await answer('Cancel');

        expect(api.patch).not.toHaveBeenCalled();
        expect(dialogTitles()).toContain('Edit User');
        expect(field('Username').value).toBe('bea');
    });

    it('sends no name when it is unchanged (case and spaces aside)', async () => {
        api.get.mockResolvedValue({ data: ROWS });
        api.patch.mockResolvedValueOnce({ data: {} });
        await mount();
        await editRow('ana');
        await type('Username', ' ANA ');

        await save();

        expect(confirmText()).toBeUndefined();
        expect(api.patch).toHaveBeenCalledWith('/users', {
            updates: [
                {
                    user: 'u1',
                    update: { isActive: true, roles: [Role.Seller] },
                },
            ],
        });
    });

    it('validates the new name like a new account, inline', async () => {
        api.get.mockResolvedValue({ data: ROWS });
        await mount();
        await editRow('ana');

        await type('Username', '   ');
        await save();
        expect(fieldError('Username')).toBe(REQUIRED);
        expect(confirmText()).toBeUndefined();

        await type('Username', 'b');
        expect(fieldError('Username')).toBe('');

        // The input's maxlength stops typing; a pasted long name still
        // gets the API's limit (trimmed, as the API trims).
        field('Username').removeAttribute('maxlength');
        await type('Username', 'b'.repeat(STRING_LIMITS.USERNAME + 1));
        await save();
        expect(fieldError('Username')).toBe(
            `At most ${STRING_LIMITS.USERNAME} characters`,
        );
        expect(api.patch).not.toHaveBeenCalled();
    });

    it('shows a taken name on the field, not as a toast', async () => {
        api.get.mockResolvedValue({ data: ROWS });
        api.patch.mockRejectedValueOnce(
            httpError(400, {
                error: ErrorCode.DB_DUPLICATE_KEY,
                message: 'Duplicate key',
                details: [{ property: 'name', msg: 'Duplicate key' }],
            }),
        );
        await mount();
        await editRow('ana');
        await type('Username', 'root');
        await save();

        await answer('Rename');

        expect(fieldError('Username')).toBe('This username is already taken');
        expect(useUIStore().toasts).toEqual([]);
        expect(dialogTitles()).toContain('Edit User');

        await type('Username', 'bea');
        expect(fieldError('Username')).toBe('');
    });

    it('still toasts other failures of a rename', async () => {
        api.get.mockResolvedValue({ data: ROWS });
        api.patch.mockRejectedValueOnce(
            httpError(403, {
                error: ErrorCode.USER_TARGET_FORBIDDEN,
                message: 'Only an admin can modify an admin or a user manager',
            }),
        );
        await mount();
        await editRow('ana');
        await type('Username', 'bea');
        await save();

        await answer('Rename');

        expect(fieldError('Username')).toBe('');
        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['Only an admin can modify an admin or a user manager'],
        ]);
    });

    it('lets a user manager rename themselves and shows the new name at once', async () => {
        useAuthStore().user = {
            userId: 'm1',
            username: 'boss',
            roles: [Role.UserManager],
        };
        api.get.mockResolvedValue({ data: ROWS });
        api.patch.mockResolvedValueOnce({ data: {} });
        await mount();
        await editRow('boss');
        await type('Username', 'chief');
        await save();

        expect(dialogTitles()).toContain('Rename your account?');
        expect(confirmText()).toBe(
            'boss becomes chief. You will log in as chief.',
        );
        await answer('Rename');

        // Own roles are never sent; the session stays.
        expect(api.patch).toHaveBeenCalledWith('/users', {
            updates: [
                { user: 'm1', update: { isActive: true, name: 'chief' } },
            ],
        });
        expect(useAuthStore().user).toEqual({
            userId: 'm1',
            username: 'chief',
            roles: [Role.UserManager],
        });
    });

    it('keeps the own-row rules while the own name is being edited', async () => {
        // A cached user without an id is matched by name: typing a new
        // one must not unlock the own roles or the Active box.
        useAuthStore().user = { username: 'boss', roles: [Role.UserManager] };
        api.get.mockResolvedValue({ data: ROWS });
        await mount();
        await editRow('boss');

        await type('Username', 'chief');
        await flush();

        const seller = field(String(Role.Seller));
        expect(seller.disabled).toBe(true);
        expect(
            document.querySelector('[data-testid="self-active-hint"]'),
        ).not.toBeNull();
    });

    it('lets a user manager rename a cashier they manage', async () => {
        useAuthStore().user = {
            userId: 'm1',
            username: 'boss',
            roles: [Role.UserManager],
        };
        api.get.mockResolvedValue({ data: ROWS });
        await mount();

        await editRow('ana');
        expect(field('Username').disabled).toBe(false);

        // An admin's row does not open for a user manager at all.
        const rootEdit = [...document.querySelectorAll('tbody tr')]
            .find((tr) => tr.textContent?.includes('root'))!
            .querySelector<HTMLButtonElement>('button[aria-label^="Edit"]')!;
        expect(rootEdit.disabled).toBe(true);
    });

    it('closes the confirmation with the page', async () => {
        api.get.mockResolvedValue({ data: ROWS });
        await mount();
        await editRow('ana');
        await type('Username', 'bea');
        await save();
        expect(confirmText()).toBeDefined();

        app!.unmount();
        app = null;
        await flush();

        expect(api.patch).not.toHaveBeenCalled();
    });
});
