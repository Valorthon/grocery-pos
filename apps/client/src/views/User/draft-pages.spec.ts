/**
 * The three draft pages (products, restock, adjustments): row keys, Clear,
 * the unsaved-work guard, single submit and empty saves (issue #19), and
 * the save flow of #18. The add/edit dialogs are stubbed (see
 * `testing/stub-add-dialog.ts`); the save dialogs are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, type Component, createApp, h } from 'vue';
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
import ProductsAdd from './Products/Add.vue';
import RestockAdd from './Restock/Add.vue';
import AdjustmentAdd from './Adjustments/Add.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

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
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

const Elsewhere = { render: () => h('p', 'elsewhere') };

async function mountPage(page: Component) {
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
    await router.push('/draft');
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({ render: () => h(RouterView) });
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

        await press('Clear Drafts');
        expect(confirmText()).toBe(
            'Clear all 2 drafts? This cannot be undone.',
        );
        // The safe choice has the focus.
        expect(document.activeElement).toBe(button('Keep'));
        await press('Keep');
        expect(rows()).toHaveLength(2);

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

    it('never holds up the way to Login (logout, or the session ended)', async () => {
        await mountPage(c.page);
        await addDraft(c, 'First');

        await router.push({ name: 'Login' });

        expect(router.currentRoute.value.name).toBe('Login');
        expect(confirmText()).toBeUndefined();
    });

    it('goes to the list without asking once saved', async () => {
        api.post.mockResolvedValueOnce({ data: {} });
        await mountPage(c.page);
        await addDraft(c, 'First');
        useUIStore().clear(); // "Product added"

        await save(c);

        expect(router.currentRoute.value.name).toBe(c.list);
        expect(confirmText()).toBeUndefined();
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
