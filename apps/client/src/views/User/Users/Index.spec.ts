import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import {
    ASSIGNABLE_ROLES,
    ErrorCode,
    Role,
    STRING_LIMITS,
} from '@grocery-pos/contracts';
import { type AssignableRole, ROLE_LOOK } from '../role-look';
import {
    click,
    field,
    fieldError,
    flush,
    type,
    headerText,
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
const refreshSession = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock('@/axios', () => ({ default: api, refreshSession }));

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
    refreshSession.mockReset();
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

/** The checkbox on a role's card in the open dialog (#297). */
function roleBox(role: Role): HTMLInputElement {
    const box = document.querySelector<HTMLInputElement>(
        `[data-testid="role-card-${role}"] input`,
    );
    if (!box) throw new Error(`No card for ${role}`);
    return box;
}

async function checkRole(role: Role, checked: boolean): Promise<void> {
    const box = roleBox(role);
    box.checked = checked;
    box.dispatchEvent(new Event('change'));
    await flush();
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
        await checkRole(Role.Seller, true);
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
            .querySelector<HTMLElement>('tbody tr[data-row-click] td')!
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
            .querySelector<HTMLElement>('tbody tr[data-row-click] td')!
            .click();
        await flush();

        await checkRole(Role.Restocker, true);
        await checkRole(Role.Seller, false);
        await flush();
        expect(rowRoles()).toContain('Seller');
        expect(rowRoles()).not.toContain('Restocker');

        await click('Cancel');
        expect(rowRoles()).toContain('Seller');
        expect(rowRoles()).not.toContain('Restocker');

        // Reopened, the editor starts again from the row.
        document
            .querySelector<HTMLElement>('tbody tr[data-row-click] td')!
            .click();
        await flush();
        const seller = roleBox(Role.Seller);
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
        await checkRole(Role.Seller, true);

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

    it('clears the name with the box (x) in one request, and its form submits (#171, #215)', async () => {
        api.get.mockResolvedValue({ data: USERS });
        await mount();
        expect(
            field('Search Name').form?.querySelector('button[type="submit"]'),
        ).not.toBeNull();
        await type('Search Name', 'Ana');
        await click('Search');
        api.get.mockClear();

        expect(document.querySelector('[data-chip]')).toBeNull();
        expect(document.body.textContent).not.toContain('Clear Filters');
        document
            .querySelector<HTMLButtonElement>('button[aria-label="Clear"]')!
            .click();
        await flush();

        expect(api.get.mock.calls.map(([, c]) => c?.params)).toEqual([
            expect.objectContaining({ page: 1, name: '' }),
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

        await checkRole(Role.Seller, true);
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
        await checkRole(Role.Seller, true);

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
        const row = [...document.querySelectorAll('tbody tr')].find(
            (tr) => tr.querySelector('td')?.textContent?.trim() === name,
        )!;
        row.querySelector<HTMLElement>('td')!.click();
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
        const row = [...document.querySelectorAll('tbody tr')].find(
            (tr) => tr.querySelector('td')?.textContent?.trim() === name,
        )!;
        row.querySelector<HTMLElement>('td')!.click();
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
        // Someone else's rename leaves the logged-in user as they were,
        // and their session alone.
        expect(useAuthStore().user?.username).toBe('boss');
        expect(refreshSession).not.toHaveBeenCalled();
        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['User updated'],
        ]);
    });

    it('scrolls a tall Edit User body inside the dialog (#217)', async () => {
        api.get.mockResolvedValue({ data: ROWS });
        await mount();
        await editRow('ana');
        const body = document.querySelector<HTMLElement>('[data-modal-body]')!;
        expect(body.className).toContain('overflow-y-auto');
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

    it('measures the length lowercased, as the API does', async () => {
        api.get.mockResolvedValue({ data: ROWS });
        await mount();
        await editRow('ana');
        // "İ" lowercases to two code units: at the limit as typed, over
        // it as the API stores it.
        await type('Username', 'İ'.repeat(STRING_LIMITS.USERNAME));

        await save();

        expect(fieldError('Username')).toBe(
            `At most ${STRING_LIMITS.USERNAME} characters`,
        );
        expect(confirmText()).toBeUndefined();
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

    it('toasts a duplicate key that does not name the username', async () => {
        api.get.mockResolvedValue({ data: ROWS });
        api.patch.mockRejectedValueOnce(
            httpError(400, {
                error: ErrorCode.DB_DUPLICATE_KEY,
                message: 'Duplicate key',
                details: [{ property: 'email', msg: 'Duplicate key' }],
            }),
        );
        await mount();
        await editRow('ana');
        await type('Username', 'bea');
        await save();

        await answer('Rename');

        expect(fieldError('Username')).toBe('');
        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['email: Duplicate key'],
        ]);
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
        api.get.mockImplementation((url) =>
            Promise.resolve({
                data:
                    url === '/users/profile'
                        ? {
                              userId: 'm1',
                              username: 'chief',
                              roles: [Role.UserManager],
                          }
                        : ROWS,
            }),
        );
        api.patch.mockResolvedValueOnce({ data: {} });
        refreshSession.mockResolvedValueOnce();
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
        // The token is refreshed so the server's copy has the new name
        // too (a reload would otherwise show the old one), then re-read.
        expect(refreshSession).toHaveBeenCalledTimes(1);
        const profileRead = api.get.mock.calls.findIndex(
            ([url]) => url === '/users/profile',
        );
        expect(profileRead).toBeGreaterThan(-1);
        expect(refreshSession.mock.invocationCallOrder[0]!).toBeLessThan(
            api.get.mock.invocationCallOrder[profileRead]!,
        );
    });

    it('keeps the new name when the refresh after a self-rename fails', async () => {
        useAuthStore().user = {
            userId: 'm1',
            username: 'boss',
            roles: [Role.UserManager],
        };
        api.get.mockResolvedValue({ data: ROWS });
        api.patch.mockResolvedValueOnce({ data: {} });
        refreshSession.mockRejectedValueOnce(
            new AxiosError('timeout', 'ECONNABORTED'),
        );
        await mount();
        await editRow('boss');
        await type('Username', 'chief');
        await save();
        await answer('Rename');

        expect(refreshSession).toHaveBeenCalledTimes(1);
        expect(api.get).not.toHaveBeenCalledWith('/users/profile');
        expect(useAuthStore().user?.username).toBe('chief');
        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['User updated'],
        ]);
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

        const seller = roleBox(Role.Seller);
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

        // An admin's row does not open for a user manager at all (#311):
        // it isn't clickable, and its ⋯ menu says why.
        await click('Cancel');
        await vi.waitFor(() =>
            expect(document.querySelector('[role=dialog]')).toBeNull(),
        );
        const rootRow = [...document.querySelectorAll('tbody tr')].find((tr) =>
            tr.textContent?.includes('root'),
        )!;
        expect(rootRow.hasAttribute('data-row-click')).toBe(false);
        expect(rootRow.getAttribute('tabindex')).toBeNull();
        rootRow.querySelector<HTMLElement>('td')!.click();
        await flush();
        expect(document.querySelector('[role=dialog]')).toBeNull();
        rootRow
            .querySelector<HTMLButtonElement>(
                'button[aria-label="Actions for root"]',
            )!
            .click();
        await flush();
        const edit = [
            ...document.querySelectorAll<HTMLButtonElement>('[role=menuitem]'),
        ].find((b) => b.textContent?.includes('Edit'))!;
        expect(edit.getAttribute('aria-disabled')).toBe('true');
        expect(edit.textContent).toContain('Only an admin can edit this user');
        expect(
            [...document.querySelectorAll('[role=menuitem]')].map((b) =>
                b.firstChild?.textContent?.trim(),
            ),
        ).toEqual(['Edit']);
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

describe('manager PIN entry point (#34)', () => {
    const managerRows = {
        data: [
            {
                _id: 'mgr',
                name: 'supervisor',
                roles: [Role.Supervisor],
                isActive: true,
            },
        ],
        totalItems: 1,
    };
    it('lets an admin open PIN management for a supervisor and close without a write', async () => {
        api.get.mockResolvedValue({ data: managerRows });
        await mount();
        expect(await menuItems('supervisor')).toEqual(['Edit', 'Manager PIN']);
        [...document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')]
            .find((b) => b.textContent?.trim() === 'Manager PIN')!
            .click();
        await flush();
        expect(document.body.textContent).toContain(
            'Set a new manager PIN for supervisor',
        );
        await click('Cancel');
        expect(api.patch).not.toHaveBeenCalled();
    });
    it('opens Edit user from the row on Enter, with Actions right-aligned (#311)', async () => {
        api.get.mockResolvedValue({ data: managerRows });
        await mount();
        const th = Array.from(document.querySelectorAll('thead th')).pop()!;
        expect(th.className).toContain('text-right');
        const row = document.querySelector<HTMLElement>('tbody tr')!;
        expect(row.tabIndex).toBe(0);
        row.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
        await flush();
        expect(document.body.textContent).toContain('Edit User');
    });
    it('does not offer manager PIN management to a user manager', async () => {
        useAuthStore().user = {
            username: 'users-manager',
            roles: [Role.UserManager],
        };
        api.get.mockResolvedValue({ data: managerRows });
        await mount();
        expect(await menuItems('supervisor')).not.toContain('Manager PIN');
    });
});

/** Opens a user's ⋯ menu (#311) and lists its item labels. */
async function menuItems(name: string): Promise<string[]> {
    document
        .querySelector<HTMLButtonElement>(
            `button[aria-label="Actions for ${name}"]`,
        )!
        .click();
    await flush();
    return [...document.querySelectorAll('[role=menuitem]')].map(
        (b) => b.firstChild?.textContent?.trim() ?? '',
    );
}

/** Header texts visible below `sm` (no `hidden` class), issue #208. */
function narrowHeaders(): string[] {
    return Array.from(document.querySelectorAll('thead th'))
        .filter((th) => !th.className.split(/\s+/).includes('hidden'))
        .map((th) => headerText(th));
}

describe('users list at 375px (issue #208)', () => {
    it('keeps Name, Status and Actions, hiding Roles below sm', async () => {
        api.get.mockResolvedValue({ data: USERS });
        await mount();
        expect(narrowHeaders()).toEqual(['Name', 'Status', 'Actions']);
    });
});

describe('column help (#263)', () => {
    it('explains Roles (hidden with it below sm) and Status', async () => {
        api.get.mockResolvedValue({ data: USERS });
        await mount();
        const about = (label: string) =>
            document.querySelector<HTMLButtonElement>(
                `thead [aria-label="About ${label}"]`,
            );
        expect(about('Status')).not.toBeNull();
        const roles = about('Roles')!;
        expect(roles.closest('th')!.className).toContain(
            'hidden sm:table-cell',
        );
        const tip = document.getElementById(
            roles.getAttribute('aria-describedby')!,
        )!;
        expect(tip.querySelectorAll('dt')).toHaveLength(6);
        expect(about('Name')).toBeNull();
    });
});

describe('role cards (#297)', () => {
    const cards = () =>
        [...document.querySelectorAll('[data-testid^="role-card-"]')].map((c) =>
            c.getAttribute('data-testid')!.replace('role-card-', ''),
        );
    const lockedHint = () =>
        document.querySelector('[data-testid="roles-locked-hint"]')
            ?.textContent;
    async function openEditor() {
        document
            .querySelector<HTMLElement>('tbody tr[data-row-click] td')!
            .click();
        await flush();
    }

    it('shows one card per role with its name and description', async () => {
        api.get.mockResolvedValue({ data: USERS });
        api.post.mockResolvedValueOnce({ data: {} });
        await mount();
        await click('Add User');

        expect(cards()).toEqual([...ASSIGNABLE_ROLES]);
        for (const role of ASSIGNABLE_ROLES) {
            const look = ROLE_LOOK[role as AssignableRole];
            const box = roleBox(role);
            const name = document.getElementById(
                box.getAttribute('aria-labelledby')!,
            );
            const desc = document.getElementById(
                box.getAttribute('aria-describedby')!,
            );
            expect(name?.textContent?.trim()).toBe(look.label);
            expect(desc?.textContent?.trim()).toBe(look.description);
            // The whole card is the checkbox's label.
            expect(box.closest('label')?.dataset.testid).toBe(
                `role-card-${role}`,
            );
        }

        await type('Username', 'bea');
        await type('Password', 'long-enough-1');
        await checkRole(Role.Restocker, true);
        expect(
            document.querySelector(
                `[data-testid="role-card-${Role.Restocker}"]`,
            )!.className,
        ).toContain('border-leaf-600');
        await checkRole(Role.Adjuster, true);
        await checkRole(Role.Restocker, false);
        await click('Save');

        expect(api.post).toHaveBeenCalledWith('/users', {
            users: [
                {
                    name: 'bea',
                    password: 'long-enough-1',
                    roles: [Role.Adjuster],
                },
            ],
        });
    });

    it('lists only grantable roles on create for a user manager', async () => {
        useAuthStore().user = { username: 'boss', roles: [Role.UserManager] };
        api.get.mockResolvedValue({ data: USERS });
        await mount();
        await click('Add User');

        expect(cards()).toEqual([Role.Seller, Role.Adjuster, Role.Restocker]);
    });

    it('disables roles a user manager cannot grant, saying why', async () => {
        useAuthStore().user = { username: 'boss', roles: [Role.UserManager] };
        api.get.mockResolvedValue({ data: USERS });
        await mount();
        await openEditor();

        expect(cards()).toEqual([...ASSIGNABLE_ROLES]);
        expect(roleBox(Role.Seller).disabled).toBe(false);
        expect(roleBox(Role.Admin).disabled).toBe(true);
        expect(roleBox(Role.UserManager).disabled).toBe(true);
        expect(roleBox(Role.Supervisor).disabled).toBe(true);
        // A disabled card's checkbox is also described by the reason.
        expect(roleBox(Role.Admin).getAttribute('aria-describedby')).toContain(
            'roles-locked-hint',
        );
        expect(
            roleBox(Role.Seller).getAttribute('aria-describedby'),
        ).not.toContain('roles-locked-hint');
        expect(
            document
                .querySelector('[role="group"]')
                ?.getAttribute('aria-labelledby'),
        ).toBe('edit-roles-heading');
        expect(lockedHint()).toContain(
            'Only an admin can grant User manager, Admin, Supervisor.',
        );
    });

    it('shows no reason when an admin edits another user', async () => {
        api.get.mockResolvedValue({ data: USERS });
        await mount();
        await openEditor();

        for (const role of ASSIGNABLE_ROLES) {
            expect(roleBox(role).disabled).toBe(false);
        }
        expect(lockedHint()).toBeUndefined();
    });

    it('disables every role on the own row', async () => {
        useAuthStore().user = {
            userId: 'u1',
            username: 'ana',
            roles: [Role.Admin],
        };
        api.get.mockResolvedValue({ data: USERS });
        await mount();
        await openEditor();

        for (const role of ASSIGNABLE_ROLES) {
            expect(roleBox(role).disabled).toBe(true);
        }
        expect(lockedHint()).toContain("You can't change your own roles.");
    });

    it('shows friendly role names in the list', async () => {
        api.get.mockResolvedValue({
            data: {
                data: [
                    {
                        _id: 'm1',
                        name: 'boss',
                        roles: [Role.UserManager, Role.Seller],
                        isActive: true,
                    },
                ],
                totalItems: 1,
            },
        });
        await mount();
        const cell = document
            .querySelector('tbody tr')!
            .querySelectorAll('td')[1]!;
        expect(cell.textContent).toContain('User manager');
        expect(cell.textContent).toContain('Seller');
        expect(cell.textContent).not.toContain(Role.UserManager);
    });
});

describe('step-up re-auth (#310)', () => {
    const reauthRequired = () =>
        httpError(403, {
            error: ErrorCode.USER_REAUTH_REQUIRED,
            message: 'Confirm your password to make this change',
        });
    const reauthOpen = () =>
        document.body.textContent?.includes("Confirm it's you") ?? false;

    async function editAna() {
        const row = [...document.querySelectorAll('tbody tr')].find(
            (tr) => tr.querySelector('td')?.textContent?.trim() === 'ana',
        )!;
        row.querySelector<HTMLElement>('td')!.click();
        await flush();
    }

    async function confirmPassword() {
        await type('Your password', 'my-own-password');
        const dialog = [...document.querySelectorAll('[role="dialog"]')].find(
            (d) => d.textContent?.includes("Confirm it's you"),
        )!;
        [...dialog.querySelectorAll('button')]
            .find((b) => b.textContent?.trim() === 'Confirm')!
            .click();
        await flush();
    }

    it('Add User prompts, then retries the same request once', async () => {
        api.get.mockResolvedValue({ data: USERS });
        api.post
            .mockRejectedValueOnce(reauthRequired())
            .mockResolvedValue({ data: undefined });
        await mount();
        await click('Add User');
        await type('Username', 'bea');
        await type('Password', 'long-enough-1');
        await checkRole(Role.Seller, true);
        await click('Save');

        expect(reauthOpen()).toBe(true);
        await confirmPassword();

        const body = {
            users: [
                {
                    name: 'bea',
                    password: 'long-enough-1',
                    roles: [Role.Seller],
                },
            ],
        };
        expect(api.post.mock.calls).toEqual([
            ['/users', body],
            ['/auth/reauth', { password: 'my-own-password' }],
            ['/users', body],
        ]);
        await new Promise((r) => setTimeout(r, 300));
        expect(reauthOpen()).toBe(false);
        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['User created'],
        ]);
    });

    it('Edit User with a guarded change prompts, then succeeds', async () => {
        api.get.mockResolvedValue({ data: USERS });
        api.patch
            .mockRejectedValueOnce(reauthRequired())
            .mockResolvedValue({ data: {} });
        api.post.mockResolvedValue({ data: undefined });
        await mount();
        await editAna();
        await checkRole(Role.Adjuster, true);
        await click('Save');

        expect(reauthOpen()).toBe(true);
        await confirmPassword();

        expect(api.patch).toHaveBeenCalledTimes(2);
        expect(api.patch.mock.calls[0]).toEqual(api.patch.mock.calls[1]);
        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['User updated'],
        ]);
    });

    it('Cancel saves nothing and keeps the edit dialog with its values', async () => {
        api.get.mockResolvedValue({ data: USERS });
        api.patch.mockRejectedValueOnce(reauthRequired());
        await mount();
        await editAna();
        await checkRole(Role.Adjuster, true);
        await click('Save');
        const dialog = [...document.querySelectorAll('[role="dialog"]')].find(
            (d) => d.textContent?.includes("Confirm it's you"),
        )!;
        [...dialog.querySelectorAll('button')]
            .find((b) => b.textContent?.trim() === 'Cancel')!
            .click();
        await flush();

        expect(api.patch).toHaveBeenCalledOnce();
        expect(api.post).not.toHaveBeenCalled();
        await new Promise((r) => setTimeout(r, 300));
        expect(reauthOpen()).toBe(false);
        expect(roleBox(Role.Adjuster).checked).toBe(true);
        expect(useUIStore().toasts).toEqual([]);
    });

    it('a rename that the server accepts does not prompt', async () => {
        api.get.mockResolvedValue({ data: USERS });
        api.patch.mockResolvedValue({ data: {} });
        await mount();
        await editAna();
        await type('Username', 'bea');
        await click('Save');
        const confirm = [...document.querySelectorAll('[role="dialog"]')].find(
            (d) => d.textContent?.includes('will log in as'),
        )!;
        [...confirm.querySelectorAll('button')]
            .find((b) => b.textContent?.trim() === 'Rename')!
            .click();
        await flush();

        expect(reauthOpen()).toBe(false);
        expect(api.patch).toHaveBeenCalledOnce();
        expect(api.post).not.toHaveBeenCalled();
    });
});
