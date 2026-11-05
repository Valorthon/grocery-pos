import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useStockAlertsStore } from './stockAlerts';
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
beforeEach(() => {
    setActivePinia(createPinia());
});
describe('sidebar low-stock badge', () => {
    it('uses the same list count and exposes retryable failures', async () => {
        const store = useStockAlertsStore();
        api.get.mockRejectedValueOnce(new Error('network'));
        await store.refresh();
        expect(store.error).toBe(true);
        expect(store.count).toBeNull();
        api.get.mockResolvedValueOnce({ data: { data: [], totalItems: 7 } });
        await store.refresh();
        expect(store.error).toBe(false);
        expect(store.count).toBe(7);
        expect(api.get).toHaveBeenLastCalledWith('/inventories', {
            params: { page: 1, limit: 1, lowStock: true },
        });
    });
    it('does not let a stale response restore a reset account count', async () => {
        let resolve!: (value: unknown) => void;
        api.get.mockImplementationOnce(
            () =>
                new Promise((yes) => {
                    resolve = yes;
                }),
        );
        const store = useStockAlertsStore();
        const waiting = store.refresh();
        store.reset();
        resolve({ data: { totalItems: 99 } });
        await waiting;
        expect(store.count).toBeNull();
    });
});
