import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { UnitOfMeasure, type InventoryRow } from '@grocery-pos/contracts';
import { useAuthStore } from './auth';
import { usePurchaseOrderPrefillStore } from './purchaseOrderPrefill';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
let pinia = createPinia();
beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
});
afterEach(() => disposePinia(pinia));
const rows = () =>
    [
        {
            product: {
                _id: 'p',
                EAN: '4006381333931',
                name: 'rice',
                unit: UnitOfMeasure.KG,
                reorderQuantity: 4500,
            },
        },
    ] as InventoryRow[];
describe('purchase order prefill handoff (#123)', () => {
    it('hands the reorder quantities over once', () => {
        useAuthStore().user = { userId: 'a', username: 'r', roles: [] };
        const store = usePurchaseOrderPrefillStore();
        expect(store.prepare(rows())).toBe(true);
        expect(store.take()).toEqual([
            {
                product: 'p',
                name: 'rice',
                EAN: '4006381333931',
                unit: UnitOfMeasure.KG,
                quantity: '4.500',
                tracksExpiry: undefined,
                cost: '0.00',
            },
        ]);
        expect(store.take()).toEqual([]);
    });
    it('never hands one account’s draft to another', () => {
        const store = usePurchaseOrderPrefillStore();
        expect(store.prepare(rows())).toBe(false);
        const auth = useAuthStore();
        auth.user = { userId: 'a', username: 'a', roles: [] };
        store.prepare(rows());
        auth.user = { userId: 'b', username: 'b', roles: [] };
        auth.user = { userId: 'a', username: 'a', roles: [] };
        expect(store.take()).toEqual([]);
    });
});
