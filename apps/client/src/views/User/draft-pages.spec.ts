/**
 * The three draft pages (products, restock, adjustments): row keys, Clear,
 * the unsaved-work guard, single submit and empty saves (issue #19), and
 * the save flow of #18. The add/edit dialogs are stubbed (see
 * `testing/stub-add-dialog.ts`); the save dialogs are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, type Component, createApp, h, ref, type VNode } from 'vue';
import {
    createMemoryHistory,
    createRouter,
    type Router,
    RouterView,
} from 'vue-router';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { flush, type } from '@/testing/form-dom';
import { nextDraft } from '@/testing/stub-add-dialog';
import { Color, useUIStore } from '@/stores/ui';
import { Role, useAuthStore } from '@/stores/auth';
import ProductsAdd from './Products/Add.vue';
import RestockAdd from './Restock/Add.vue';
import AdjustmentAdd from './Adjustments/Add.vue';
import ChangePasswordDialog from '@/components/User/Account/ChangePasswordDialog.vue';
import {
    PASSWORD_CHANGED,
    PASSWORD_CHANGED_STAYED,
} from '@/components/User/Account/change-password';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

// The auth store logs out through the app router: point it at this
// spec's router.
const routerRef = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/router', () => ({
    get default() {
        return routerRef.current;
    },
}));

vi.mock('@/components/User/Product/AddDialog.vue', async () =>
    (await import('@/testing/stub-add-dialog')).stubAddDialogModule(),
);
vi.mock('@/components/User/Restock/AddDialog.vue', async () =>
    (await import('@/testing/stub-add-dialog')).stubAddDialogModule(),
);
vi.mock('@/components/User/Adjustments/AddDialog.vue', async () =>
    (await import('@/testing/stub-add-dialog')).stubAddDialogModule(),
);

const PRODUCT = '507f1f77bcf86cd799439011';

interface PageCase {
    page: Component;
    /** The list route the page goes to once saved. */
    list: string;
    /** The page's own save button. */
    saveLabel: string;
    /** The save dialog's title; none for products (saved in place). */
    dialogTitle?: string;
    emptyMessage: string;
    /** Two drafts that share every would-be key (EAN, product). */
    draft: (name: string) => Record<string, unknown>;
}

const cases: [string, PageCase][] = [
    [
        'products',
        {
            page: ProductsAdd,
            list: 'Products',
            saveLabel: 'Save All',
            emptyMessage: 'No products to save',
            // Auto-generated barcodes: both EANs are ''.
            draft: (name) => ({
                EAN: '',
                name,
                price: 1000,
                autoGenerateEAN: true,
            }),
        },
    ],
    [
        'restock',
        {
            page: RestockAdd,
            list: 'Restocks',
            saveLabel: 'Save',
            dialogTitle: 'Save Restock Info',
            emptyMessage: 'No restock lines to save',
            draft: (name) => ({
                isNewProduct: true,
                autoGenerateEAN: true,
                EAN: '',
                name,
                price: 1000,
                quantity: 2,
                unitCost: 500,
            }),
        },
    ],
    [
        'adjustment',
        {
            page: AdjustmentAdd,
            list: 'Adjustments',
            saveLabel: 'Save',
            dialogTitle: 'Save Adjustment Info',
            emptyMessage: 'No adjustments to save',
            // Two lines for the same product.
            draft: (name) => ({
                EAN: '4006381333931',
                name: 'Bread',
                product: PRODUCT,
                change: -1,
                reason: name,
            }),
        },
    ],
];

function httpError(status: number, message: string): AxiosError {
    const config = { headers: new AxiosHeaders() };
    return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, {
        status,
        statusText: '',
        headers: {},
        config,
        data: { statusCode: status, message },
    } as AxiosResponse);
}

function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

let app: App | null = null;
let pinia: Pinia;
let router: Router;

beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    api.post.mockReset();
    nextDraft.value = {};
    // Signed in: a user and the session marker cookie.
    Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => 'dummy=true',
    });
    useAuthStore().user = { username: 'ana', roles: [Role.Admin] };
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

const Elsewhere = { render: () => h('p', 'elsewhere') };

/**
 * `beside`: rendered next to the page, as a layout's own dialogs are
 * (e.g. the profile menu's change-password dialog, #88).
 */
async function mountPage(page: Component, beside?: () => VNode) {
    router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/draft', name: 'Draft', component: page },
            { path: '/other', name: 'Other', component: Elsewhere },
            { path: '/login', name: 'Login', component: Elsewhere },
            { path: '/products', name: 'Products', component: Elsewhere },
            { path: '/restocks', name: 'Restocks', component: Elsewhere },
            { path: '/adjustments', name: 'Adjustments', component: Elsewhere },
        ],
    });
    routerRef.current = router;
    await router.push('/draft');
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () => (beside ? [h(RouterView), beside()] : h(RouterView)),
    });
    app.use(pinia);
    app.use(router);
    app.mount(host);
    await flush();
}

const buttons = () => [...document.body.querySelectorAll('button')];

/** The button whose whole text is `text`. */
function button(text: string): HTMLButtonElement {
    const found = buttons().find((b) => b.textContent?.trim() === text);
    if (!found) throw new Error(`No button "${text}"`);
    return found;
}

async function press(text: string) {
    button(text).click();
    await flush();
}

async function addDraft(c: PageCase, name: string) {
    nextDraft.value = c.draft(name);
    // "Add Product" or "Adjust Stock": the page's first button.
    buttons()[0].click();
    await flush();
    await press('Stub submit');
}

const rows = () => [...document.body.querySelectorAll('tbody tr')];
const rowTexts = () => rows().map((r) => r.textContent ?? '');

function rowAction(row: Element, label: 'Edit draft' | 'Delete draft') {
    return row.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
}

const confirmText = () =>
    [...document.body.querySelectorAll('p')]
        .map((p) => p.textContent?.trim())
        .find((t) => t?.includes('draft'));

async function save(c: PageCase) {
    await press(c.saveLabel);
    if (!c.dialogTitle) return;
    await type('Description', 'weekly delivery');
    const saves = buttons().filter((b) => b.textContent?.trim() === 'Save');
    saves[saves.length - 1].click();
    await flush();
}

const beforeUnloadBlocked = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
};

describe.each(cases)('%s draft page (issue #19)', (_, c) => {
    it('keeps each row on its own key through edit and delete', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await mountPage(c.page);
        await addDraft(c, 'First');
        await addDraft(c, 'Second');
        const [first, second] = rows();
        expect(rowTexts()[0]).toContain('First');
        expect(rowTexts()[1]).toContain('Second');

        // Edit the second row: only it changes, in place.
        nextDraft.value = c.draft('Second edited');
        rowAction(second, 'Edit draft').click();
        await flush();
        await press('Stub submit');
        expect(rows()).toHaveLength(2);
        expect(rowTexts()[0]).toContain('First');
        expect(rowTexts()[1]).toContain('Second edited');
        expect(rows()[0]).toBe(first);
        expect(rows()[1]).toBe(second);

        // Delete the first: the second row's own element stays.
        rowAction(first, 'Delete draft').click();
        await flush();
        expect(rows()).toHaveLength(1);
        expect(rows()[0]).toBe(second);
        expect(rowTexts()[0]).toContain('Second edited');
        expect(
            warn.mock.calls.some((args) =>
                String(args[0]).includes('Duplicate keys'),
            ),
        ).toBe(false);
    });

    it('never sends the draft ids', async () => {
        api.post.mockResolvedValueOnce({ data: {} });
        await mountPage(c.page);
        await addDraft(c, 'First');
        await addDraft(c, 'Second');

        await save(c);

        expect(api.post).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(api.post.mock.calls[0][1])).not.toContain(
            'draft',
        );
    });

    it('clears the drafts only once confirmed', async () => {
        await mountPage(c.page);
        await addDraft(c, 'First');
        await addDraft(c, 'Second');

        button('Clear Drafts').focus();
        await press('Clear Drafts');
        expect(confirmText()).toBe(
            'Clear all 2 drafts? This cannot be undone.',
        );
        // The safe choice has the focus.
        expect(document.activeElement).toBe(button('Keep'));
        await press('Keep');
        expect(rows()).toHaveLength(2);
        // The focus goes back to the button that asked.
        expect(document.activeElement).toBe(button('Clear Drafts'));

        await press('Clear Drafts');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await flush();
        expect(rows()).toHaveLength(2);

        await press('Clear Drafts');
        await press('Clear');
        expect(rows()).toHaveLength(0);
        expect(button('Clear Drafts').disabled).toBe(true);

        // Nothing left to lose: leaving no longer asks.
        await router.push('/other');
        expect(router.currentRoute.value.name).toBe('Other');
    });

    it('asks before leaving with drafts: Stay stays, Leave leaves', async () => {
        await mountPage(c.page);
        await addDraft(c, 'First');

        const leaving = router.push('/other');
        await flush();
        expect(confirmText()).toBe(
            'You have 1 unsaved draft. Leave and discard it?',
        );
        expect(document.activeElement).toBe(button('Stay'));
        await press('Stay');
        await leaving;
        expect(router.currentRoute.value.name).toBe('Draft');
        expect(rows()).toHaveLength(1);

        await addDraft(c, 'Second');
        const again = router.push('/other');
        await flush();
        expect(confirmText()).toBe(
            'You have 2 unsaved drafts. Leave and discard them?',
        );
        await press('Leave');
        await again;
        expect(router.currentRoute.value.name).toBe('Other');
    });

    it('leaves without asking when there are no drafts', async () => {
        await mountPage(c.page);
        await router.push('/other');
        expect(router.currentRoute.value.name).toBe('Other');
    });

    it('asks before Log out: Stay keeps the session and the drafts', async () => {
        await mountPage(c.page);
        const auth = useAuthStore();
        await addDraft(c, 'First');

        const stayed = auth.requestLogout();
        await flush();
        expect(confirmText()).toBe(
            'You have 1 unsaved draft. Log out and discard it?',
        );
        expect(document.activeElement).toBe(button('Stay'));
        await press('Stay');

        expect(await stayed).toBe(false);
        expect(router.currentRoute.value.name).toBe('Draft');
        expect(api.post).not.toHaveBeenCalled();
        expect(auth.user).not.toBeNull();
        expect(auth.userLogoutPending).toBe(false);
        expect(rows()).toHaveLength(1);
    });

    describe('after a password change (#88)', () => {
        const dialogOpen = ref(false);
        const dialog = () =>
            h(ChangePasswordDialog, {
                modelValue: dialogOpen.value,
                'onUpdate:modelValue': (value: boolean) => {
                    dialogOpen.value = value;
                },
            });

        async function changePassword() {
            dialogOpen.value = true;
            await flush();
            await type('Current password', 'secret');
            await type('New password', 'new-secret');
            await type('Confirm new password', 'new-secret');
            await press('Change password');
        }

        beforeEach(() => {
            dialogOpen.value = false;
            api.patch.mockReset().mockResolvedValue({ data: '' });
        });

        it('asks before logging out; Stay keeps the drafts and says to log out later', async () => {
            await mountPage(c.page, dialog);
            const auth = useAuthStore();
            await addDraft(c, 'First');

            await changePassword();

            expect(api.patch).toHaveBeenCalledTimes(1);
            expect(dialogOpen.value).toBe(false);
            expect(confirmText()).toBe(
                'You have 1 unsaved draft. Log out and discard it?',
            );
            await press('Stay');

            expect(router.currentRoute.value.name).toBe('Draft');
            expect(api.post).not.toHaveBeenCalled();
            expect(auth.user).not.toBeNull();
            expect(rows()).toHaveLength(1);
            // Only the notice: the page's own toasts (e.g. products' "added")
            // may be up too.
            const notice = useUIStore().toasts.filter((t) =>
                t.lines.includes(PASSWORD_CHANGED_STAYED),
            );
            expect(notice.map((t) => [t.color, t.sticky])).toEqual([
                [Color.INFO, true],
            ]);
        });

        it('logs out to Login with the notice once "Log out" is chosen', async () => {
            api.post.mockResolvedValue({});
            await mountPage(c.page, dialog);
            await addDraft(c, 'First');

            await changePassword();
            await press('Log out');

            expect(router.currentRoute.value.name).toBe('Login');
            expect(api.post.mock.calls).toEqual([['/auth/logout']]);
            expect(useAuthStore().user).toBeNull();
            expect(useUIStore().toasts.map((t) => [t.color, t.lines])).toEqual([
                [Color.SUCCESS, [PASSWORD_CHANGED]],
            ]);
        });
    });

    it('logs out once "Log out" is chosen', async () => {
        api.post.mockResolvedValue({});
        await mountPage(c.page);
        const auth = useAuthStore();
        await addDraft(c, 'First');

        const done = auth.requestLogout();
        await flush();
        await press('Log out');

        expect(await done).toBe(true);
        expect(router.currentRoute.value.name).toBe('Login');
        expect(api.post.mock.calls).toEqual([['/auth/logout']]);
        expect(auth.user).toBeNull();
        expect(useUIStore().toasts).toEqual([]);
    });

    it('logs out without asking when there are no drafts', async () => {
        api.post.mockResolvedValue({});
        await mountPage(c.page);
        const auth = useAuthStore();

        expect(await auth.requestLogout()).toBe(true);

        expect(confirmText()).toBeUndefined();
        expect(router.currentRoute.value.name).toBe('Login');
        expect(api.post.mock.calls).toEqual([['/auth/logout']]);
    });

    it('never holds up a forced logout (the session ended)', async () => {
        api.post.mockResolvedValue({});
        await mountPage(c.page);
        const auth = useAuthStore();
        await addDraft(c, 'First');

        // What the axios interceptor runs when the refresh gets a 401.
        await auth.logout('Please log in to continue');

        expect(confirmText()).toBeUndefined();
        expect(router.currentRoute.value.name).toBe('Login');
        expect(api.post.mock.calls).toEqual([['/auth/logout']]);
        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['Please log in to continue'],
        ]);
    });

    it('never holds up the way to Login when the session is gone', async () => {
        await mountPage(c.page);
        await addDraft(c, 'First');
        useAuthStore().user = null;

        // The router guard's redirect when no session is left.
        await router.push({ name: 'Login' });

        expect(router.currentRoute.value.name).toBe('Login');
        expect(confirmText()).toBeUndefined();
    });

    it('still asks on the way to Login while signed in (not a logout)', async () => {
        await mountPage(c.page);
        await addDraft(c, 'First');

        const leaving = router.push('/login');
        await flush();
        expect(confirmText()).toBe(
            'You have 1 unsaved draft. Leave and discard it?',
        );
        await press('Stay');
        await leaving;
        expect(router.currentRoute.value.name).toBe('Draft');
    });

    it('holds navigation without asking while the save is in flight', async () => {
        const pending = deferred<{ data: object }>();
        api.post.mockReturnValueOnce(pending.promise);
        await mountPage(c.page);
        await addDraft(c, 'First');
        useUIStore().clear(); // "Product added"
        await save(c);
        expect(api.post).toHaveBeenCalledTimes(1);

        await router.push('/other');
        expect(router.currentRoute.value.name).toBe('Draft');
        expect(confirmText()).toBeUndefined();
        expect(useUIStore().toasts.map((t) => [t.color, t.lines])).toEqual([
            [Color.INFO, ['Saving… please wait']],
        ]);

        // Log out waits too.
        expect(await useAuthStore().requestLogout()).toBe(false);
        expect(router.currentRoute.value.name).toBe('Draft');
        expect(api.post).toHaveBeenCalledTimes(1);

        pending.resolve({ data: {} });
        await flush();
        expect(router.currentRoute.value.name).toBe(c.list);
    });

    it('stays on Login when a save settles after a forced logout', async () => {
        const pending = deferred<{ data: object }>();
        api.post.mockReturnValueOnce(pending.promise);
        await mountPage(c.page);
        await addDraft(c, 'First');
        await save(c);

        api.post.mockResolvedValue({});
        await useAuthStore().logout('Please log in to continue');
        expect(router.currentRoute.value.name).toBe('Login');

        pending.resolve({ data: {} });
        await flush();
        expect(router.currentRoute.value.name).toBe('Login');
        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['Please log in to continue'],
        ]);
    });

    it('reports nothing when a save fails after a forced logout', async () => {
        let fail!: (e: unknown) => void;
        api.post.mockReturnValueOnce(
            new Promise((_, reject) => {
                fail = reject;
            }),
        );
        await mountPage(c.page);
        await addDraft(c, 'First');
        await save(c);

        api.post.mockResolvedValue({});
        await useAuthStore().logout('Please log in to continue');
        fail(httpError(401, 'Unauthorized'));
        await flush();

        expect(router.currentRoute.value.name).toBe('Login');
        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['Please log in to continue'],
        ]);
    });

    it('goes to the list without asking once saved', async () => {
        api.post.mockResolvedValueOnce({ data: {} });
        await mountPage(c.page);
        await addDraft(c, 'First');
        useUIStore().clear(); // "Product added"

        await save(c);

        expect(router.currentRoute.value.name).toBe(c.list);
        expect(confirmText()).toBeUndefined();
        // Every dialog closed: the page scrolls again.
        expect(document.body.style.overflow).toBe('');
        expect(useUIStore().toasts.map((t) => t.color)).toEqual([
            Color.SUCCESS,
        ]);
    });

    it('keeps the drafts and the guard when the save fails', async () => {
        api.post.mockRejectedValueOnce(httpError(400, 'Items too many'));
        await mountPage(c.page);
        await addDraft(c, 'First');
        useUIStore().clear(); // "Product added"

        await save(c);

        expect(router.currentRoute.value.name).toBe('Draft');
        expect(rows()).toHaveLength(1);
        expect(beforeUnloadBlocked()).toBe(true);
        if (c.dialogTitle) {
            // #18: the dialog stays open with the error.
            const titles = [...document.querySelectorAll('h2')].map((t) =>
                t.textContent?.trim(),
            );
            expect(titles).toContain(c.dialogTitle);
            expect(document.body.style.overflow).toBe('hidden');
        }
        expect(useUIStore().toasts.map((t) => [t.color, t.lines])).toEqual([
            [Color.ERROR, ['Items too many']],
        ]);
    });

    it('refuses an empty save with a message and no request', async () => {
        await mountPage(c.page);

        await press(c.saveLabel);

        expect(api.post).not.toHaveBeenCalled();
        expect(document.querySelector('h2')).toBeNull();
        expect(useUIStore().toasts.map((t) => [t.color, t.lines])).toEqual([
            [Color.ERROR, [c.emptyMessage]],
        ]);
    });

    it('prompts on tab close only while there are drafts', async () => {
        const add = vi.spyOn(window, 'addEventListener');
        const remove = vi.spyOn(window, 'removeEventListener');
        await mountPage(c.page);
        expect(beforeUnloadBlocked()).toBe(false);

        await addDraft(c, 'First');
        expect(beforeUnloadBlocked()).toBe(true);

        rowAction(rows()[0], 'Delete draft').click();
        await flush();
        expect(beforeUnloadBlocked()).toBe(false);

        await addDraft(c, 'Again');
        expect(beforeUnloadBlocked()).toBe(true);
        app!.unmount();
        app = null;
        expect(beforeUnloadBlocked()).toBe(false);

        const listener = (spy: typeof add) =>
            spy.mock.calls.filter(([type]) => type === 'beforeunload');
        expect(listener(add)).toHaveLength(2);
        expect(listener(remove)).toHaveLength(2);
    });
});

describe('products Save All (issue #19)', () => {
    it('is busy while saving, so a double click posts once', async () => {
        const pending = deferred<{ data: object }>();
        api.post.mockReturnValueOnce(pending.promise);
        await mountPage(ProductsAdd);
        await addDraft(cases[0][1], 'First');

        const saveAll = button('Save All');
        saveAll.click();
        saveAll.click();
        await flush();

        expect(api.post).toHaveBeenCalledTimes(1);
        // Busy: the spinner replaces the label and the button is disabled.
        expect(saveAll.disabled).toBe(true);
        expect(button('Clear Drafts').disabled).toBe(true);
        expect(button('Add Product').disabled).toBe(true);
        saveAll.click();
        await flush();
        expect(api.post).toHaveBeenCalledTimes(1);

        pending.resolve({ data: {} });
        await flush();
        expect(router.currentRoute.value.name).toBe('Products');
    });

    it('is usable again after a failed save', async () => {
        api.post.mockRejectedValueOnce(httpError(400, 'Duplicate name'));
        await mountPage(ProductsAdd);
        await addDraft(cases[0][1], 'First');

        await press('Save All');

        expect(button('Save All').disabled).toBe(false);
        expect(rows()).toHaveLength(1);
    });
});

describe('a confirmation over the save dialog (issue #19)', () => {
    it.each([
        ['restock', cases[1][1]],
        ['adjustment', cases[2][1]],
    ])('%s: Escape closes only the confirmation', async (_, c) => {
        await mountPage(c.page);
        await addDraft(c, 'First');
        await press(c.saveLabel);
        await type('Description', 'weekly delivery');

        // The back button while the save dialog is open.
        const leaving = router.push('/other');
        await flush();
        expect(confirmText()).toBe(
            'You have 1 unsaved draft. Leave and discard it?',
        );

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await leaving;
        await flush();

        // The confirmation answered "Stay"; the save dialog is still open.
        expect(router.currentRoute.value.name).toBe('Draft');
        const titles = [...document.querySelectorAll('h2')].map((t) =>
            t.textContent?.trim(),
        );
        expect(titles).toContain(c.dialogTitle);
        expect(
            document.body.querySelector<HTMLInputElement>('input[maxlength]')
                ?.value,
        ).toBe('weekly delivery');
        expect(document.body.style.overflow).toBe('hidden');
    });
});

describe('restock at a ₱0 unit cost (#85)', () => {
    const restockCase = cases[1][1];

    async function addRestockLine(name: string, unitCost: number) {
        nextDraft.value = { ...restockCase.draft(name), unitCost };
        buttons()[0].click();
        await flush();
        await press('Stub submit');
    }

    const dialogTitles = () =>
        [...document.querySelectorAll('h2')].map((t) => t.textContent?.trim());
    const question = () =>
        [...document.body.querySelectorAll('p')]
            .map((p) => p.textContent?.trim())
            .find((t) => t?.includes('₱0 unit cost'));

    it('asks first, naming the ₱0 lines; Go back keeps the drafts and sends nothing', async () => {
        await mountPage(restockCase.page);
        await addRestockLine('Paid', 500);
        await addRestockLine('Sample', 0);
        useUIStore().clear();

        await press('Save');

        expect(dialogTitles()).toContain('Record at ₱0 cost?');
        expect(question()).toBe(
            '1 line has a ₱0 unit cost: Sample. Record it at ₱0 cost?',
        );
        expect(dialogTitles()).not.toContain(restockCase.dialogTitle);

        await press('Go back');

        expect(dialogTitles()).not.toContain(restockCase.dialogTitle);
        expect(rows()).toHaveLength(2);
        expect(api.post).not.toHaveBeenCalled();
        expect(router.currentRoute.value.name).toBe('Draft');
    });

    it('sends a unit cost of 0 once confirmed', async () => {
        api.post.mockResolvedValueOnce({ data: {} });
        await mountPage(restockCase.page);
        await addRestockLine('Paid', 500);
        await addRestockLine('Sample', 0);
        useUIStore().clear();

        await press('Save');
        await press('Record at ₱0');
        expect(dialogTitles()).toContain(restockCase.dialogTitle);
        await type('Description', 'free samples');
        const saves = buttons().filter((b) => b.textContent?.trim() === 'Save');
        saves[saves.length - 1].click();
        await flush();

        expect(api.post).toHaveBeenCalledTimes(1);
        const [url, body] = api.post.mock.calls[0] as [
            string,
            { restockDetails: { unitCost: number }[] },
        ];
        expect(url).toBe('/restocks');
        expect(body.restockDetails.map((d) => d.unitCost)).toEqual([500, 0]);
        expect(router.currentRoute.value.name).toBe('Restocks');
    });

    it('does not ask when every line has a cost', async () => {
        await mountPage(restockCase.page);
        await addRestockLine('Paid', 500);

        await press('Save');

        expect(question()).toBeUndefined();
        expect(dialogTitles()).toContain(restockCase.dialogTitle);
    });
});
