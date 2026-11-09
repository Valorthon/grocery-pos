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
    api.get.mockResolvedValue({ data: { data: rows(), totalItems: 2 } });
    nav.push.mockResolvedValue(undefined);
    nav.replace.mockResolvedValue(undefined);
});
afterEach(() => {
    app?.unmount();
    disposePinia(pinia);
    document.body.innerHTML = '';
});
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
    it('applies a low-stock toggle once on page one and retains server order', async () => {
        route.query = {};
        await mount();
        api.get.mockClear();
        const checkbox = field('Low stock');
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));
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

describe('inventory FilterBar (#171)', () => {
    it('removes the low-stock chip with one load and one route change', async () => {
        await mount();
        api.get.mockClear();
        nav.replace.mockClear();

        document
            .querySelector<HTMLButtonElement>(
                'button[aria-label="Remove filter Low stock"]',
            )!
            .click();
        await flush();
        // The router then drops the query; its watcher must not reload.
        route.query = {};
        await flush();

        expect(api.get).toHaveBeenCalledTimes(1);
        expect(api.get.mock.calls[0]?.[1]?.params).toMatchObject({
            page: 1,
            lowStock: undefined,
        });
        expect(nav.replace).toHaveBeenCalledTimes(1);
        expect(nav.replace).toHaveBeenCalledWith({
            query: { lowStock: undefined },
        });
    });

    it('removes the name chip with one load, keeping the low-stock filter', async () => {
        await mount();
        await type('Product Name', 'rice');
        field('Product Name').form!.requestSubmit();
        await flush();
        await type('Product Name', 'bread');
        api.get.mockClear();

        document
            .querySelector<HTMLButtonElement>(
                'button[aria-label="Remove filter Name: rice"]',
            )!
            .click();
        await flush();

        expect(api.get).toHaveBeenCalledTimes(1);
        expect(api.get.mock.calls[0]?.[1]?.params).toMatchObject({
            page: 1,
            name: '',
            lowStock: true,
        });
    });
});

describe('low-stock frame (#159)', () => {
    const meta: RouteMeta = {
        title: 'Inventory',
        queryTitle: { key: 'lowStock', value: 'true', title: 'Low stock' },
    };

    it('titles the low-stock list and shows its FilterBar chip (#171)', async () => {
        route = reactive({
            name: 'Inventories',
            query: { lowStock: 'true' },
            meta,
        });
        await mount();
        const h1s = document.querySelectorAll('h1');
        expect(h1s).toHaveLength(1);
        expect(h1s[0].textContent?.trim()).toBe('Low stock');
        // The FilterBar chip replaced the header badge (#171).
        expect(
            document.querySelector('[data-testid="low-stock-chip"]'),
        ).toBeNull();
        expect(
            document.querySelector(
                'button[aria-label="Remove filter Low stock"]',
            ),
        ).not.toBeNull();
    });

    it('shows plain Inventory without the chip', async () => {
        route = reactive({ name: 'Inventories', query: {}, meta });
        await mount();
        expect(document.querySelector('h1')?.textContent?.trim()).toBe(
            'Inventory',
        );
        expect(
            document.querySelector(
                'button[aria-label="Remove filter Low stock"]',
            ),
        ).toBeNull();
    });
});
