import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import type { InventoryBatchView } from '@grocery-pos/contracts';
import { useAuthStore } from './auth';
import { useAdjustmentPrefillStore } from './adjustmentPrefill';
vi.mock('@/axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
let pinia = createPinia();
const lot = {
    _id: 'batch',
    product: { _id: 'p', EAN: '1', name: 'Milk' },
    remainingQty: 3,
} as InventoryBatchView;
beforeEach(() => {
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
});
afterEach(() => disposePinia(pinia));
it('only transfers positive remainders for the same user, once', () => {
    const store = useAdjustmentPrefillStore();
    expect(store.prepare(lot)).toBe(false);
    useAuthStore().user = { userId: 'a', username: 'a', roles: [] };
    expect(store.prepare({ ...lot, remainingQty: 0 })).toBe(false);
    expect(store.prepare({ ...lot, remainingQty: -1 })).toBe(false);
    expect(store.prepare(lot)).toBe(true);
    expect(store.take()).toMatchObject({
        batch: 'batch',
        product: 'p',
        change: -3,
    });
    expect(store.take()).toBeUndefined();
});
it('clears private draft when account changes, even if it switches back', () => {
    const auth = useAuthStore();
    auth.user = { userId: 'a', username: 'a', roles: [] };
    const store = useAdjustmentPrefillStore();
    store.prepare({ ...lot, batchNo: 'A', expiryDate: '2026-01-01' });
    auth.user = null;
    auth.user = { userId: 'a', username: 'a', roles: [] };
    expect(store.take()).toBeUndefined();
});
