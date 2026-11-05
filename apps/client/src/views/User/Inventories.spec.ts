import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, reactive, type App } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { Role, UnitOfMeasure, type InventoryRow } from '@grocery-pos/contracts';
import { click, field, flush } from '@/testing/form-dom';
import { useAuthStore } from '@/stores/auth';
import { useRestockPrefillStore } from '@/stores/restockPrefill';
import type { ApiGet } from '@/testing/api-mock';
import Inventories from './Inventories.vue';
import RestockAdd from './Restock/Add.vue';
const api = vi.hoisted(() => ({ get: vi.fn<ApiGet>(), post: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
let route: { query: Record<string, string>; name: string };
vi.mock('vue-router', () => ({
    useRoute: () => route,
    useRouter: () => nav,
    onBeforeRouteLeave: vi.fn(),
}));
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
    it('adjusters can inspect the list but are not offered a restock action', async () => {
        useAuthStore().user = {
            userId: 'a',
            username: 'a',
            roles: [Role.Adjuster],
        };
        await mount();
        expect(document.body.textContent).not.toContain('Restock listed items');
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
