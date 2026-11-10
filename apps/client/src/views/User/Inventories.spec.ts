import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, reactive, type App } from 'vue';
import type { RouteMeta, Router } from 'vue-router';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { Role, UnitOfMeasure, type InventoryRow } from '@grocery-pos/contracts';
import { click, field, flush, type } from '@/testing/form-dom';
import { useAuthStore } from '@/stores/auth';
import { usePurchaseOrderPrefillStore } from '@/stores/purchaseOrderPrefill';
import { useRestockPrefillStore } from '@/stores/restockPrefill';
import type { ApiGet } from '@/testing/api-mock';
import Inventories from './Inventories.vue';
import { AxiosError, AxiosHeaders } from 'axios';
import RestockAdd from './Restock/Add.vue';
const api = vi.hoisted(() => ({ get: vi.fn<ApiGet>(), post: vi.fn() }));
const nav = vi.hoisted(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    resolve: null as null | Router['resolve'],
}));
vi.mock('@/axios', () => ({ default: api }));
let route: {
    query: Record<string, string>;
    name: string;
    meta?: RouteMeta;
};
vi.mock('vue-router', async (importOriginal) => ({
    ...(await importOriginal<typeof import('vue-router')>()),
    useRoute: () => route,
    useRouter: () => nav,
    onBeforeRouteLeave: vi.fn(),
}));
// The app's own route table answers `resolve`, so the Adjust button follows
// the real Adjustments/Add meta (#206).
const { default: appRouter } = await import('@/router');
nav.resolve = appRouter.resolve.bind(appRouter);
let app: App | undefined;
let pinia = createPinia();
const rows = (): InventoryRow[] =>
    [
        {
            product: {
                _id: 'rice',
                EAN: '4006381333931',
                name: 'rice',
                price: 18000,
                unit: UnitOfMeasure.KG,
                reorderLevel: 9000,
                reorderQuantity: 2500,
            },
            stock: 450,
        },
        {
            product: {
                _id: 'bread',
                EAN: '12345670',
                name: 'bread',
                price: 100,
                reorderQuantity: 20,
            },
            stock: 0,
        },
    ] as InventoryRow[];
beforeEach(() => {
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
    route = reactive({ name: 'Inventories', query: { lowStock: 'true' } });
    useAuthStore().user = {
        userId: 'r',
        username: 'r',
        roles: [Role.Restocker],
    };
    // The always-shown batches panel (#233) lists nothing by default.
    api.get.mockImplementation((url: string) =>
        Promise.resolve({
            data:
                url === '/inventories'
                    ? { data: rows(), totalItems: 2 }
                    : url === '/inventories/expiry-tracking'
                      ? { trackedProducts: 1 }
                      : { data: [], totalItems: 0 },
        }),
    );
    nav.push.mockResolvedValue(undefined);
    nav.replace.mockResolvedValue(undefined);
});
afterEach(() => {
    app?.unmount();
    disposePinia(pinia);
    document.body.innerHTML = '';
});
/** A segment of the stock-status control (#232). */
function segment(label: string): HTMLButtonElement {
    return [
        ...document.querySelectorAll<HTMLButtonElement>(
            '[data-testid="stock-filter"] button',
        ),
    ].find((b) => b.textContent?.trim() === label)!;
}
const pressed = (label: string) =>
    segment(label).getAttribute('aria-pressed') === 'true';
async function closeDialog() {
    document.querySelector<HTMLElement>('button[aria-label="Close"]')!.click();
    await flush();
}
async function mount(component = Inventories) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(component);
    app.use(pinia);
    app.mount(host);
    await flush();
}
describe('reorder list and restock draft', () => {
    it('preserves server severity order and prefills measured quantities with no stock write', async () => {
        await mount();
        expect(api.get.mock.calls[0]?.[0]).toBe('/inventories');
        expect(api.get.mock.calls[0]?.[1]?.params).toMatchObject({
            lowStock: true,
            page: 1,
        });
        const names = [...document.querySelectorAll('tbody tr')].map(
            (row) => row.textContent,
        );
        expect(names[0]).toContain('rice');
        expect(names[1]).toContain('bread');
        await click('Restock listed items');
        expect(nav.push).toHaveBeenCalledWith({ name: 'Restocks/Add' });
        app?.unmount();
        app = undefined;
        document.body.innerHTML = '';
        await mount(RestockAdd);
        expect(document.body.textContent).toContain('rice');
        expect(document.body.textContent).toContain('2.500 kg');
        expect(document.body.textContent).toContain('20 pc');
        expect(api.post).not.toHaveBeenCalled();
        expect(useRestockPrefillStore().take()).toEqual([]);
    });
    it('hands the listed items to a purchase-order draft once (#123)', async () => {
        await mount();
        await click('Create purchase order');
        expect(nav.push).toHaveBeenCalledWith({ name: 'PurchaseOrders' });
        const lines = usePurchaseOrderPrefillStore().take();
        expect(lines.map((line) => line.name)).toEqual(['rice', 'bread']);
        expect(api.post).not.toHaveBeenCalled();
        expect(usePurchaseOrderPrefillStore().take()).toEqual([]);
    });
    it('adjusters can inspect the list but are not offered a restock action', async () => {
        useAuthStore().user = {
            userId: 'a',
            username: 'a',
            roles: [Role.Adjuster],
        };
        await mount();
        expect(document.body.textContent).not.toContain('Restock listed items');
        expect(document.body.textContent).not.toContain(
            'Create purchase order',
        );
        expect(document.body.textContent).toContain('Adjust');
    });
    it('offers Adjust only to roles that may open the adjustment page (#206)', async () => {
        await mount();
        const labels = () =>
            [...document.querySelectorAll('button')].map((b) =>
                b.textContent!.trim(),
            );
        expect(labels()).not.toContain('Adjust');
        app!.unmount();
        useAuthStore().user = {
            userId: 'x',
            username: 'x',
            roles: [Role.Admin],
        };
        await mount();
        expect(labels()).toContain('Adjust');
    });
    it('describes the empty New restock as adding restock lines (#206)', async () => {
        await mount(RestockAdd);
        expect(document.body.textContent).toContain('No restock lines yet');
        expect(document.body.textContent).toContain(
            'Click "Add Product" to add a line for each product received.',
        );
        expect(document.body.textContent).not.toContain('No new products');
    });
    it('fits Product, Stock, Status and a 44px history icon at phone width (#210, #232)', async () => {
        await mount();
        const ths = [
            ...document
                .querySelectorAll('table')[0]
                .querySelectorAll('thead th'),
        ];
        expect(ths.map((t) => t.textContent?.trim())).toEqual([
            'Product',
            'Stock',
            'Reorder at',
            'Status',
            'History',
        ]);
        const th = (text: string) =>
            ths.find((cell) => cell.textContent?.includes(text))!;
        const classes = (el: Element) => el.className.split(/\s+/);
        expect(classes(th('Reorder at'))).toEqual(
            expect.arrayContaining(['hidden', 'md:table-cell']),
        );
        expect(classes(th('Status'))).toEqual(
            expect.arrayContaining(['hidden', 'sm:table-cell']),
        );
        for (const shown of ['Product', 'Stock', 'History'])
            expect(classes(th(shown))).not.toContain('hidden');
        expect(classes(th('Stock'))).toContain('text-right');
        expect(classes(th('Reorder at'))).toContain('text-right');
        const button = document.querySelector<HTMLElement>(
            '[data-testid="stock-history-button"]',
        )!;
        expect(button.getAttribute('aria-label')).toBe(
            'Stock history for rice',
        );
        expect(classes(button)).toEqual(
            expect.arrayContaining(['min-h-11', 'min-w-11']),
        );
        expect(button.textContent?.trim()).toBe('');
        button.click();
        await flush();
        const product = document.querySelector(
            '[data-testid="stock-history-product"]',
        );
        expect(product?.textContent).toContain('EAN 4006381333931');
        expect(product?.textContent).toContain('Reorder level 9');
    });
    it('shows the EAN under the name, as typed, at every width (#232)', async () => {
        await mount();
        const cell = document.querySelector('tbody tr > th')!;
        expect(cell.textContent).toContain('rice');
        const ean = cell.querySelector('[data-testid="row-ean"]')!;
        expect(ean.textContent).toBe('4006381333931');
        expect(ean.className.split(/\s+/)).toEqual(
            expect.arrayContaining(['text-xs', 'text-muted', 'num']),
        );
        expect(ean.className).not.toMatch(/hidden/);
    });
    it('badges each stock state with the reorder predicate (#232)', async () => {
        route = reactive({ name: 'Inventories', query: {} });
        const row = (id: string, stock: number, reorderLevel: number) => ({
            product: {
                _id: id,
                EAN: '12345670',
                name: id,
                price: 1,
                reorderLevel,
            },
            stock,
        });
        api.get.mockImplementation((url: string) =>
            Promise.resolve({
                data:
                    url === '/inventories'
                        ? {
                              data: [
                                  row('zero', 0, 5),
                                  row('negative', -3, 5),
                                  row('atLevel', 5, 5),
                                  row('above', 6, 5),
                                  row('zeroLevel', 0, 0),
                              ],
                              totalItems: 5,
                          }
                        : { data: [], totalItems: 0 },
            }),
        );
        await mount();
        const badges = [
            ...document.querySelectorAll('[data-testid="stock-status"]'),
        ].map((b) => b.textContent?.trim());
        expect(badges).toEqual([
            'Out of stock',
            'Out of stock',
            'Low stock',
            'In stock',
            'Out of stock',
        ]);
        const first = document.querySelector('[data-testid="stock-status"]')!;
        expect(first.className).toContain('text-danger-fg');
        const rows = document.querySelectorAll('tbody tr');
        expect(rows[2].querySelector('.text-warning-fg')).not.toBeNull();
        expect(rows[3].querySelector('.text-success-fg')).not.toBeNull();
    });
    it('opens Stock history on a row click and on Enter or Space (#232)', async () => {
        await mount();
        const rows = document.querySelectorAll<HTMLTableRowElement>('tbody tr');
        expect(rows[1].tabIndex).toBe(0);
        expect(rows[1].getAttribute('aria-describedby')).toBeTruthy();
        rows[1].querySelector('td')!.click();
        await flush();
        expect(document.body.textContent).toContain('Stock history — bread');
        await closeDialog();
        expect(document.body.textContent).not.toContain('Stock history —');
        for (const key of ['Enter', ' ']) {
            rows[0].dispatchEvent(
                new KeyboardEvent('keydown', { key, bubbles: true }),
            );
            await flush();
            expect(document.body.textContent).toContain('Stock history — rice');
            await closeDialog();
        }
    });
    it('pages 25 rows by default (#232)', async () => {
        await mount();
        expect(api.get.mock.calls[0]?.[1]?.params).toMatchObject({
            limit: 25,
        });
    });
    it('makes the stock filter a 44px segmented control (#232)', async () => {
        await mount();
        for (const label of ['All', 'Low stock', 'Out of stock'])
            expect(segment(label).className.split(/\s+/)).toContain('min-h-11');
        expect(pressed('Low stock')).toBe(true);
        expect(pressed('All')).toBe(false);
        expect(document.querySelector('input[type=checkbox]')).toBeNull();
    });
    it('applies a low-stock toggle once on page one and retains server order', async () => {
        route.query = {};
        await mount();
        api.get.mockClear();
        segment('Low stock').click();
        await flush();
        expect(api.get).toHaveBeenCalledTimes(1);
        expect(api.get.mock.calls[0]?.[0]).toBe('/inventories');
        expect(api.get.mock.calls[0]?.[1]?.params).toMatchObject({
            page: 1,
            lowStock: true,
        });
    });
    it('shows fetch errors, disables draft creation, and retry restores it', async () => {
        api.get.mockRejectedValueOnce(new Error('network'));
        await mount();
        expect(document.querySelector('[role=alert]')).not.toBeNull();
        const button = [...document.querySelectorAll('button')].find((button) =>
            button.textContent?.includes('Restock listed items'),
        )!;
        expect(button.disabled).toBe(true);
        await click('Retry');
        expect(button.disabled).toBe(false);
    });
});

describe('receipt-cost restock defaults', () => {
    it('uses procurement cost rather than selling price, with exact measured total', async () => {
        useRestockPrefillStore().prepare(rows());
        api.get.mockResolvedValue({
            data: [
                { product: 'rice', lastCost: 12000 },
                { product: 'bread', lastCost: 0 },
            ],
        });
        await mount(RestockAdd);
        const lines = [...document.querySelectorAll('tbody tr')];
        expect(lines[0].textContent).toContain('2.500 kg');
        expect(lines[0].textContent).toContain('120.00');
        expect(lines[0].textContent).toContain('300.00');
        expect(lines[0].textContent).not.toContain('180.00');
        expect(api.post).not.toHaveBeenCalled();
    });
    it('does not save before receipt-cost defaults settle and preserves drafts on lookup failure', async () => {
        let reject!: (value: unknown) => void;
        api.get.mockReturnValueOnce(
            new Promise((_resolve, no) => {
                reject = no;
            }),
        );
        useRestockPrefillStore().prepare(rows());
        await mount(RestockAdd);
        const save = [
            ...document.querySelectorAll<HTMLButtonElement>('button'),
        ].find((button) => button.textContent?.trim() === 'Save')!;
        expect(save.disabled).toBe(true);
        reject(new Error('offline'));
        await flush();
        expect(save.disabled).toBe(false);
        expect(document.body.textContent).toContain('rice');
        expect(document.body.textContent).toContain('0.00');
        expect(api.post).not.toHaveBeenCalled();
    });
    it('ignores receipt defaults after the draft page unmounts', async () => {
        let resolve!: (value: { data: unknown }) => void;
        api.get.mockReturnValueOnce(
            new Promise((yes) => {
                resolve = yes;
            }),
        );
        useRestockPrefillStore().prepare(rows());
        await mount(RestockAdd);
        app?.unmount();
        app = undefined;
        resolve({ data: [{ product: 'rice', lastCost: 12000 }] });
        await flush();
        expect(document.body.textContent).not.toContain('120.00');
    });
});

describe('batches panel (#233)', () => {
    it('renders without a toggle', async () => {
        route = reactive({ name: 'Inventories', query: {} });
        await mount();
        expect(document.getElementById('batch-heading')).not.toBeNull();
        const labels = [...document.querySelectorAll('button')].map(
            (b) => b.textContent ?? '',
        );
        expect(
            labels.some((t) => /Expiry and batches|Hide batches/.test(t)),
        ).toBe(false);
    });
    it('?expiring=true scrolls to and focuses the panel heading', async () => {
        const scroll = vi.fn();
        Element.prototype.scrollIntoView = scroll;
        route = reactive({ name: 'Inventories', query: { expiring: 'true' } });
        await mount();
        await flush();
        const heading = document.getElementById('batch-heading');
        expect(heading?.getAttribute('tabindex')).toBe('-1');
        expect(scroll).toHaveBeenCalled();
        expect(scroll.mock.contexts[0]).toBe(heading);
        expect(document.activeElement).toBe(heading);
    });
    it('does not move the focus without the deep link', async () => {
        const scroll = vi.fn();
        Element.prototype.scrollIntoView = scroll;
        route = reactive({ name: 'Inventories', query: {} });
        await mount();
        await flush();
        expect(scroll).not.toHaveBeenCalled();
    });
});

describe('inventory FilterBar (#171, #215)', () => {
    const clearButton = () =>
        [...document.querySelectorAll('button')].find((b) =>
            b.textContent?.includes('Clear Filters'),
        )!;
    const listCalls = () =>
        api.get.mock.calls.filter(([url]) => url === '/inventories');

    it('Clear Filters drops the low-stock and expiring deep links with one load and one route change', async () => {
        route = reactive({
            name: 'Inventories',
            query: { lowStock: 'true', expiring: 'true', keep: 'x' },
        });
        // The batches panel the expiring link opens lists nothing here.
        api.get.mockImplementation((url: string) =>
            Promise.resolve({
                data:
                    url === '/inventories'
                        ? { data: rows(), totalItems: 2 }
                        : { data: [], totalItems: 0 },
            }),
        );
        await mount();
        expect(document.querySelector('[data-chip]')).toBeNull();
        expect(clearButton().disabled).toBe(false);
        expect(
            document
                .querySelector('[data-testid="deep-link-note"]')
                ?.textContent?.replace(/\s+/g, ' '),
        ).toContain('Showing batches expiring within 7 days');
        api.get.mockClear();
        nav.replace.mockClear();

        clearButton().click();
        await flush();
        // The router then drops the query; its watcher must not reload.
        route.query = { keep: 'x' };
        await flush();
        expect(
            document.querySelector('[data-testid="deep-link-note"]'),
        ).toBeNull();
        // The batches panel stays (#233).
        expect(document.getElementById('batch-heading')).not.toBeNull();

        expect(listCalls()).toHaveLength(1);
        expect(listCalls()[0]?.[1]?.params).toMatchObject({
            page: 1,
            lowStock: undefined,
        });
        expect(nav.replace).toHaveBeenCalledTimes(1);
        expect(nav.replace).toHaveBeenCalledWith({
            query: {
                keep: 'x',
                lowStock: undefined,
                outOfStock: undefined,
                expiring: undefined,
            },
        });
        expect(pressed('Low stock')).toBe(false);
        expect(clearButton().disabled).toBe(true);
    });

    it('a typed name alone enables Clear Filters', async () => {
        route = reactive({ name: 'Inventories', query: {} });
        await mount();
        expect(clearButton().disabled).toBe(true);
        await type('Search name or barcode', 'rice');
        expect(clearButton().disabled).toBe(false);
    });
});

describe('low-stock frame (#159)', () => {
    const meta: RouteMeta = {
        title: 'Inventory',
        queryTitle: { key: 'lowStock', value: 'true', title: 'Low stock' },
    };

    it('titles the low-stock list, ticks its filter and enables Clear (#215)', async () => {
        route = reactive({
            name: 'Inventories',
            query: { lowStock: 'true' },
            meta,
        });
        await mount();
        const h1s = document.querySelectorAll('h1');
        expect(h1s).toHaveLength(1);
        expect(h1s[0].textContent?.trim()).toBe('Low stock');
        expect(
            document.querySelector('[data-testid="low-stock-chip"]'),
        ).toBeNull();
        expect(pressed('Low stock')).toBe(true);
        expect(
            [...document.querySelectorAll('button')].find((b) =>
                b.textContent?.includes('Clear Filters'),
            )?.disabled,
        ).toBe(false);
    });

    it('shows plain Inventory with Clear disabled', async () => {
        route = reactive({ name: 'Inventories', query: {}, meta });
        await mount();
        expect(document.querySelector('h1')?.textContent?.trim()).toBe(
            'Inventory',
        );
        expect(pressed('Low stock')).toBe(false);
        expect(
            [...document.querySelectorAll('button')].find((b) =>
                b.textContent?.includes('Clear Filters'),
            )?.disabled,
        ).toBe(true);
    });
});

describe('out-of-stock view (#212)', () => {
    const meta = (): RouteMeta =>
        appRouter.getRoutes().find((r) => r.name === 'Inventories')!.meta;

    it('titles the list from the route and sends outOfStock', async () => {
        route = reactive({
            name: 'Inventories',
            query: { outOfStock: 'true' },
            meta: meta(),
        });
        await mount();
        expect(document.querySelector('h1')?.textContent?.trim()).toBe(
            'Out of stock',
        );
        expect(api.get.mock.calls[0]?.[1]?.params).toMatchObject({
            outOfStock: true,
            lowStock: undefined,
        });
        expect(pressed('Out of stock')).toBe(true);
        expect(pressed('Low stock')).toBe(false);
    });

    it('offers Restock listed items and Create purchase order with reorder quantities', async () => {
        route = reactive({
            name: 'Inventories',
            query: { outOfStock: 'true' },
        });
        await mount();
        await click('Create purchase order');
        expect(nav.push).toHaveBeenCalledWith({ name: 'PurchaseOrders' });
        expect(
            usePurchaseOrderPrefillStore()
                .take()
                .map((line) => line.name),
        ).toEqual(['rice', 'bread']);
        await click('Restock listed items');
        expect(nav.push).toHaveBeenCalledWith({ name: 'Restocks/Add' });
    });

    it('offers no draft actions on the plain list', async () => {
        route = reactive({ name: 'Inventories', query: {} });
        await mount();
        expect(document.body.textContent).not.toContain('Restock listed items');
        expect(document.body.textContent).not.toContain(
            'Create purchase order',
        );
    });

    it('turns Low stock off when Out of stock is picked, and back', async () => {
        await mount(); // starts on ?lowStock=true
        api.get.mockClear();
        nav.replace.mockClear();
        segment('Out of stock').click();
        await flush();
        expect(pressed('Low stock')).toBe(false);
        expect(api.get).toHaveBeenCalledTimes(1);
        expect(api.get.mock.calls[0]?.[1]?.params).toMatchObject({
            page: 1,
            outOfStock: true,
            lowStock: undefined,
        });
        expect(nav.replace).toHaveBeenLastCalledWith({
            query: { lowStock: undefined, outOfStock: 'true' },
        });

        route.query = { outOfStock: 'true' };
        await flush();
        api.get.mockClear();
        segment('Low stock').click();
        await flush();
        expect(nav.replace).toHaveBeenLastCalledWith({
            query: { lowStock: 'true', outOfStock: undefined },
        });
        expect(pressed('Out of stock')).toBe(false);
        expect(api.get.mock.calls[0]?.[1]?.params).toMatchObject({
            lowStock: true,
            outOfStock: undefined,
        });
    });

    it('All drops both stock filters (#232)', async () => {
        await mount();
        api.get.mockClear();
        nav.replace.mockClear();
        segment('All').click();
        await flush();
        expect(api.get.mock.calls[0]?.[1]?.params).toMatchObject({
            lowStock: undefined,
            outOfStock: undefined,
        });
        expect(nav.replace).toHaveBeenLastCalledWith({
            query: { lowStock: undefined, outOfStock: undefined },
        });
        expect(pressed('All')).toBe(true);
    });

    it('Clear Filters drops the out-of-stock filter', async () => {
        route = reactive({
            name: 'Inventories',
            query: { outOfStock: 'true' },
        });
        await mount();
        api.get.mockClear();
        await click('Clear Filters');
        expect(api.get.mock.calls[0]?.[1]?.params).toMatchObject({
            outOfStock: undefined,
        });
        expect(pressed('Out of stock')).toBe(false);
    });
});

describe('inventory list scans (#214)', () => {
    it('opens Stock history for one exact match, else searches', async () => {
        route = reactive({ name: 'Inventories', query: {} });
        api.get.mockImplementation((url) =>
            url === '/products/12345670'
                ? Promise.resolve({
                      data: {
                          _id: 'bread',
                          EAN: '12345670',
                          name: 'bread',
                          isActive: false,
                      },
                  })
                : url.startsWith('/products/')
                  ? Promise.reject(
                        new AxiosError('x', '404', undefined, undefined, {
                            status: 404,
                            statusText: '',
                            headers: {},
                            config: { headers: new AxiosHeaders() },
                            data: {},
                        }),
                    )
                  : Promise.resolve({ data: { data: [], totalItems: 0 } }),
        );
        await mount();
        await type('Search name or barcode', '12345670');
        field('Search name or barcode').form!.requestSubmit();
        await flush();
        expect(document.body.textContent).toContain('Stock history — bread');
        expect(
            api.get.mock.calls.filter(([url]) => url === '/inventories'),
        ).toHaveLength(1);
        await type('Search name or barcode', '4006381333931');
        field('Search name or barcode').form!.requestSubmit();
        await flush();
        const calls = api.get.mock.calls;
        const last = calls[calls.length - 1];
        expect(last?.[0]).toBe('/inventories');
        expect(last?.[1]?.params).toMatchObject({ EAN: '4006381333931' });
        expect(last?.[1]?.params?.name).toBeFalsy();
    });
    it('searches a non-barcode term by name in the one box (#232)', async () => {
        route = reactive({ name: 'Inventories', query: {} });
        await mount();
        expect(document.querySelectorAll('[role=search] input').length).toBe(1);
        api.get.mockClear();
        await type('Search name or barcode', 'rice');
        field('Search name or barcode').form!.requestSubmit();
        await flush();
        const params = api.get.mock.calls.find(
            ([url]) => url === '/inventories',
        )?.[1]?.params;
        expect(params).toMatchObject({ name: 'RICE' });
        expect(params?.EAN).toBeFalsy();
    });
});
