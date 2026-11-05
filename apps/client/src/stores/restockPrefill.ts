import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { reorderQuantityOf, type InventoryRow } from '@grocery-pos/contracts';
import type { AddForm } from '@/components/User/Restock/dto';
import { useAuthStore } from './auth';

/** A one-time in-memory transfer, never a stock write or another user's draft. */
export const useRestockPrefillStore = defineStore('restock-prefill', () => {
    const auth = useAuthStore();
    const owner = ref<string>();
    const lines = ref<AddForm[]>([]);
    watch(
        () => auth.user?.userId,
        () => {
            owner.value = undefined;
            lines.value = [];
        },
        { flush: 'sync' },
    );
    function prepare(rows: InventoryRow[]) {
        if (!auth.user?.userId) return false;
        owner.value = auth.user.userId;
        lines.value = rows.map(({ product }) => ({
            isNewProduct: false,
            tracksExpiry: product.tracksExpiry,
            product: product._id,
            EAN: product.EAN,
            name: product.name,
            unit: product.unit,
            quantity: reorderQuantityOf(product),
            unitCost: 0,
            autoGenerateEAN: false,
        }));
        return true;
    }
    function take(): AddForm[] {
        const result = owner.value === auth.user?.userId ? lines.value : [];
        owner.value = undefined;
        lines.value = [];
        return result;
    }
    return { prepare, take };
});
