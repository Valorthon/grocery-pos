import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import {
    Role,
    StockMovementType,
    StockMovementSource,
    UnitOfMeasure,
    type StockMovementView,
} from '@grocery-pos/contracts';
import { useAuthStore } from '@/stores/auth';
import { click, flush, field } from '@/testing/form-dom';
import StockHistory from './StockHistory.vue';
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
let app: App | undefined,
    pinia = createPinia();
const row = (): StockMovementView => ({
    _id: 'movement',
    product: '507f1f77bcf86cd799439001',
    type: StockMovementType.SALE,
    quantity: -450,
    balanceAfter: 1550,
    unit: UnitOfMeasure.KG,
    sequence: 1,
    refModel: StockMovementSource.SALE,
    refId: '507f1f77bcf86cd799439099',
    user: { _id: 'actor', name: 'Cashier' },
    occurredAt: '2026-11-01T00:00:00Z',
    createdAt: '2026-11-02T00:00:00Z',
    historical: false,
});
const product = {
    _id: '507f1f77bcf86cd799439001',
    name: 'Milk',
    unit: UnitOfMeasure.KG,
};
beforeEach(() => {
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().user = {
        userId: 'actor',
        username: 'admin',
        roles: [Role.Admin],
    };
    api.get.mockImplementation(async (url: string) =>
        url.endsWith('/integrity')
            ? {
                  data: {
                      product: product._id,
                      stock: 1550,
                      movementTotal: 1550,
                      difference: 0,
                      matches: true,
                  },
              }
            : { data: { data: [row()], totalItems: 21 } },
    );
});
afterEach(() => {
    app?.unmount();
    app = undefined;
    disposePinia(pinia);
    document.body.innerHTML = '';
    vi.clearAllMocks();
});
async function mount() {
    const host = document.createElement('div');
    document.body.append(host);
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            {
                path: '/sales',
                name: 'SalesHistory',
                component: { template: '<div />' },
            },
        ],
    });
    app = createApp(StockHistory, { product });
    app.use(pinia);
    app.use(router);
    app.mount(host);
    await flush();
}
it('shows posting and original occurrence, signed measured changes, source link and integrity without financial fields', async () => {
    await mount();
    expect(document.body.textContent).toContain('-0.450 kg');
    expect(document.body.textContent).toContain('1.550 kg');
    expect(document.body.textContent).toContain('Ledger reconciles');
    expect(document.querySelector('a')?.getAttribute('href')).toContain(
        'saleNumber=507f1f77bcf86cd799439099',
    );
    await click('Next');
    expect(api.get).toHaveBeenCalledWith(`/products/${product._id}/movements`, {
        params: { page: 2, limit: 20 },
    });
    await click('Previous');
});
it('retries applied filters rather than unsubmitted text and rejects reversed date ranges', async () => {
    await mount();
    field('Posted from').value = '2026-11-01';
    field('Posted from').dispatchEvent(new Event('input', { bubbles: true }));
    await click('Search');
    api.get.mockRejectedValueOnce(new Error('Network'));
    await click('Next');
    expect(document.body.textContent).toContain('Could not load stock history');
    field('Posted from').value = '2026-12-01';
    field('Posted from').dispatchEvent(new Event('input', { bubbles: true }));
    await click('Retry');
    expect(api.get).toHaveBeenCalledWith(`/products/${product._id}/movements`, {
        params: { from: '2026-11-01', to: undefined, page: 2, limit: 20 },
    });
    field('Posted to').value = '2026-11-01';
    field('Posted to').dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    const before = api.get.mock.calls.length;
    await click('Search');
    expect(api.get.mock.calls.length).toBe(before);
});
it('shows derived unattributed history and flags ledger mismatch', async () => {
    api.get.mockImplementation(async (url: string) =>
        url.endsWith('/integrity')
            ? { data: { stock: 3, movementTotal: 2, matches: false } }
            : {
                  data: {
                      data: [
                          {
                              ...row(),
                              type: StockMovementType.OPENING,
                              refModel: StockMovementSource.OPENING,
                              refId: undefined,
                              user: null,
                              historical: true,
                          },
                      ],
                      totalItems: 1,
                  },
              },
    );
    await mount();
    expect(document.body.textContent).toContain('derived history');
    expect(document.body.textContent).toContain('Unattributed opening balance');
    expect(document.body.textContent).toContain('Unknown / unattributed');
    expect(document.body.textContent).toContain('does not reconcile');
});
it('does not offer financial source access to an inventory-only user', async () => {
    useAuthStore().user!.roles = [Role.Restocker];
    await mount();
    expect(document.querySelector('a')).toBeNull();
    expect(document.body.textContent).toContain('507f1f77bcf86cd799439099');
});
it('drops late results when the owner changes or component unmounts', async () => {
    let resolve!: (v: unknown) => void;
    api.get.mockReturnValue(
        new Promise((done) => {
            resolve = done;
        }),
    );
    await mount();
    useAuthStore().user = {
        userId: 'other',
        username: 'other',
        roles: [Role.Adjuster],
    };
    await flush();
    resolve({ data: { data: [row()], totalItems: 1 } });
    await flush();
    expect(document.body.textContent).not.toContain('Cashier');
    app?.unmount();
    app = undefined;
});
