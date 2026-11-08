import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import {
    Role,
    UnitOfMeasure,
    type InventoryBatchView,
} from '@grocery-pos/contracts';
import { useAuthStore } from '@/stores/auth';
import { useAdjustmentPrefillStore } from '@/stores/adjustmentPrefill';
import { click, field, flush } from '@/testing/form-dom';
import InventoryBatches from './InventoryBatches.vue';
import BatchSelect from './BatchSelect.vue';
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
vi.mock('vue-router', () => ({ useRouter: () => nav }));
let app: App | undefined;
let pinia = createPinia();
const batch = (): InventoryBatchView => ({
    _id: 'lot',
    product: {
        _id: 'milk',
        EAN: '12345670',
        name: 'Milk',
        unit: UnitOfMeasure.KG,
    },
    batchNo: 'Milk-1',
    expiryDate: '2026-01-01',
    daysLeft: -2,
    receivedQty: 2000,
    remainingQty: 450,
    reconciliation: false,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
});
beforeEach(() => {
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().user = {
        userId: 'a',
        username: 'a',
        roles: [Role.Adjuster],
    };
    api.get.mockResolvedValue({ data: { data: [batch()], totalItems: 1 } });
    nav.push.mockResolvedValue(undefined);
});
afterEach(() => {
    app?.unmount();
    app = undefined;
    disposePinia(pinia);
    document.body.innerHTML = '';
    vi.clearAllMocks();
});
async function mount(component = InventoryBatches, props = {}) {
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(component, props);
    app.use(pinia);
    app.mount(host);
    await flush();
}
it('shows store-day expiry, measured remainder and prefills a batch-specific adjustment without stock writes', async () => {
    await mount();
    expect(document.body.textContent).toContain('Expired 2 days ago');
    expect(document.body.textContent).toContain('0.450 kg');
    expect(api.get).toHaveBeenCalledWith('/inventories/expiring', {
        params: { page: 1, limit: 25, days: 7 },
    });
    await click('Write off');
    expect(nav.push).toHaveBeenCalledWith({ name: 'Adjustments/Add' });
    expect(useAdjustmentPrefillStore().take()).toMatchObject({
        product: 'milk',
        batch: 'lot',
        change: -450,
        unit: UnitOfMeasure.KG,
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(useAdjustmentPrefillStore().take()).toBeUndefined();
});
it('offers expiry review without adjustment controls to restockers', async () => {
    useAuthStore().user!.roles = [Role.Restocker];
    await mount();
    expect(document.body.textContent).not.toContain('Write off');
});
it('reviews reconciliation deficits without pretending they have a date or a writeoff quantity', async () => {
    api.get.mockResolvedValue({
        data: {
            data: [
                {
                    ...batch(),
                    expiryDate: undefined,
                    daysLeft: undefined,
                    remainingQty: -450,
                    reconciliation: true,
                    batchNo: undefined,
                },
            ],
            totalItems: 1,
        },
    });
    await mount();
    expect(document.body.textContent).toContain('Reconciliation / unknown');
    expect(document.body.textContent).toContain('-0.450 kg');
    expect(document.body.textContent).not.toContain('Write off');
});
it('validates day boundaries, supports all batches and preserves server paging', async () => {
    api.get.mockResolvedValue({ data: { data: [batch()], totalItems: 26 } });
    await mount();
    const days = field('Expiring within');
    days.value = '-1';
    days.dispatchEvent(new Event('input'));
    await click('Show expiring');
    expect(document.querySelector('[role=alert]')?.textContent).toContain(
        'whole number',
    );
    await click('All remaining batches');
    expect(api.get).toHaveBeenLastCalledWith('/inventories/batches', {
        params: { page: 1, limit: 25 },
    });
    await click('Next');
    expect(api.get).toHaveBeenLastCalledWith('/inventories/batches', {
        params: { page: 2, limit: 25 },
    });
    await click('Previous');
    expect(api.get).toHaveBeenLastCalledWith('/inventories/batches', {
        params: { page: 1, limit: 25 },
    });
});
it('reports fetch errors and retries while hiding stale rows', async () => {
    api.get.mockRejectedValueOnce(new Error('network'));
    await mount();
    expect(document.querySelector('[role=alert]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Milk-1');
    await click('Retry');
    expect(document.body.textContent).toContain('Milk-1');
});
it('drops a late list response after unmount', async () => {
    let resolve!: (value: unknown) => void;
    api.get.mockReturnValue(
        new Promise((done) => {
            resolve = done;
        }),
    );
    await mount();
    app?.unmount();
    app = undefined;
    resolve({ data: { data: [batch()], totalItems: 1 } });
    await flush();
    expect(document.body.textContent).not.toContain('Milk-1');
});
it('loads explicit batch choices, preserves selection while paging, and reports retryable errors', async () => {
    api.get.mockRejectedValueOnce(new Error('offline'));
    await mount(BatchSelect as typeof InventoryBatches, { product: 'milk' });
    expect(document.querySelector('[role=alert]')).not.toBeNull();
    await click('Retry');
    expect(document.querySelector('option[value=lot]')?.textContent).toContain(
        '0.450 kg',
    );
});
it('bounds batch option pagination and treats empty product as no request', async () => {
    api.get.mockResolvedValue({ data: { data: [batch()], totalItems: 101 } });
    await mount(BatchSelect as typeof InventoryBatches, { product: 'milk' });
    await click('More batches');
    expect(api.get).toHaveBeenLastCalledWith('/inventories/batches', {
        params: { product: 'milk', page: 2, limit: 100 },
    });
    await click('Previous batches');
    expect(api.get).toHaveBeenLastCalledWith('/inventories/batches', {
        params: { product: 'milk', page: 1, limit: 100 },
    });
    app?.unmount();
    app = undefined;
    api.get.mockClear();
    await mount(BatchSelect as typeof InventoryBatches, { product: '' });
    expect(api.get).not.toHaveBeenCalled();
});
it('lists batches in a BaseTable with right-aligned quantities and an empty state only once loaded (#170)', async () => {
    await mount();
    const remaining = [...document.querySelectorAll('thead th')].find(
        (th) => th.textContent?.trim() === 'Remaining',
    )!;
    expect(remaining.className).toContain('text-right num');
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
    let resolve!: (value: unknown) => void;
    api.get.mockReturnValue(
        new Promise((done) => {
            resolve = done;
        }),
    );
    await mount();
    expect(document.body.textContent).not.toContain('No matching batches');
    resolve({ data: { data: [], totalItems: 0 } });
    await flush();
    expect(document.body.textContent).toContain('No matching batches');
});
it('shows a load failure in the table with Retry, never the empty state (#170)', async () => {
    api.get.mockRejectedValueOnce(new Error('network'));
    await mount();
    expect(
        document.querySelector('[data-testid="table-error"]'),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain('No matching batches');
});
it('replaces stale rows with a skeleton while switching to all batches (#170)', async () => {
    await mount();
    expect(document.body.textContent).toContain('Milk-1');
    api.get.mockReturnValue(new Promise(() => {}));
    await click('All remaining batches');
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Milk-1');
});
