import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { InventoryRow, Paginated } from '@grocery-pos/contracts';
import api from '@/axios';

/** Non-monetary alert count, using exactly the paginated reorder-list predicate. */
export const useStockAlertsStore = defineStore('stock-alerts', () => {
    const count = ref<number | null>(null);
    const error = ref(false);
    let generation = 0;
    function reset() {
        generation++;
        count.value = null;
        error.value = false;
    }
    async function refresh() {
        const attempt = ++generation;
        try {
            const response = await api.get<Paginated<InventoryRow>>(
                '/inventories',
                { params: { page: 1, limit: 1, lowStock: true } },
            );
            if (attempt !== generation) return;
            count.value = response.data.totalItems;
            error.value = false;
        } catch {
            if (attempt !== generation) return;
            count.value = null;
            error.value = true;
        }
    }
    return { count, error, refresh, reset };
});
