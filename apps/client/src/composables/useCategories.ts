import { ref, onMounted, onBeforeUnmount } from 'vue';
import api from '@/axios';
import {
    type CategoryDto,
    type Paginated,
    PAGINATION,
} from '@grocery-pos/contracts';
import { apiErrorText } from '@/utils/api-error';
/** Component-scoped snapshot. Opening another form refreshes after category edits. */
export function useCategories() {
    const categories = ref<CategoryDto[]>([]);
    const error = ref('');
    const loading = ref(false);
    let generation = 0;
    async function refresh() {
        const turn = ++generation;
        loading.value = true;
        error.value = '';
        try {
            const rows: CategoryDto[] = [];
            for (let page = 1; page <= PAGINATION.PAGE_MAX; page++) {
                const { data } = await api.get<Paginated<CategoryDto>>(
                    '/categories',
                    { params: { page, limit: 100, status: 'all' } },
                );
                if (turn !== generation) return;
                const batch = data.data ?? [];
                rows.push(...batch);
                if (batch.length === 0 || rows.length >= data.totalItems) break;
            }
            if (turn === generation) categories.value = rows;
        } catch (cause) {
            if (turn === generation)
                error.value = apiErrorText(cause, 'Could not load categories.');
        } finally {
            if (turn === generation) loading.value = false;
        }
    }
    onMounted(() => void refresh());
    onBeforeUnmount(() => {
        generation++;
    });
    return { categories, error, loading, refresh };
}
