import { onBeforeUnmount, onMounted, ref } from 'vue';
import api from '@/axios';
import { apiErrorText } from '@/utils/api-error';
import type { Paginated, SupplierView } from '@grocery-pos/contracts';

export function useSuppliers() {
    const suppliers = ref<SupplierView[]>([]),
        loading = ref(false),
        error = ref('');
    let generation = 0;
    async function refresh() {
        const current = ++generation;
        loading.value = true;
        error.value = '';
        try {
            const rows: SupplierView[] = [];
            let page = 1;
            for (;;) {
                const result = await api.get<Paginated<SupplierView>>(
                    '/suppliers',
                    { params: { page, limit: 100, status: 'all' } },
                );
                if (current !== generation) return;
                rows.push(...result.data.data);
                if (
                    rows.length >= result.data.totalItems ||
                    !result.data.data.length
                )
                    break;
                page++;
            }
            suppliers.value = rows;
        } catch (cause) {
            if (current === generation)
                error.value = apiErrorText(cause, 'Unable to load suppliers.');
        } finally {
            if (current === generation) loading.value = false;
        }
    }
    onMounted(refresh);
    onBeforeUnmount(() => {
        generation++;
    });
    return { suppliers, loading, error, refresh };
}
