import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { UnitOfMeasure, type InventoryRow } from '@grocery-pos/contracts';
import { useAuthStore } from './auth';
import { useRestockPrefillStore } from './restockPrefill';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
let pinia = createPinia();
beforeEach(() => {
    localStorage.clear();
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
describe('restock prefill handoff', () => {
    it('creates existing-product lines with base quantities and reviewable zero costs without stock writes', () => {
        useAuthStore().user = { userId: 'a', username: 'restocker', roles: [] };
        const store = useRestockPrefillStore();
        expect(store.prepare(rows())).toBe(true);
        expect(store.take()).toEqual([
            {
                isNewProduct: false,
                product: 'p',
                EAN: '4006381333931',
                name: 'rice',
                unit: UnitOfMeasure.KG,
                quantity: 4500,
                unitCost: 0,
                autoGenerateEAN: false,
            },
        ]);
        expect(store.take()).toEqual([]);
    });
    it('rejects unauthenticated handoff and discards on owner change even if they switch back', () => {
        const store = useRestockPrefillStore();
        expect(store.prepare(rows())).toBe(false);
        const auth = useAuthStore();
        auth.user = { userId: 'a', username: 'a', roles: [] };
        store.prepare(rows());
        auth.user = { userId: 'b', username: 'b', roles: [] };
        auth.user = { userId: 'a', username: 'a', roles: [] };
        expect(store.take()).toEqual([]);
    });
});
