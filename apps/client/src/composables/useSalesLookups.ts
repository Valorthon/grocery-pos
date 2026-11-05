import { onMounted, onBeforeUnmount, ref } from 'vue';
import api from '@/axios';
import type { CategoryDto, Paginated, UserView } from '@grocery-pos/contracts';
import { apiErrorText } from '@/utils/api-error';

/** Admin-only filters include archived categories and inactive cashiers for history. */
export function useSalesLookups(enabled = true) {
    const categories = ref<CategoryDto[]>([]);
    const cashiers = ref<{ _id: string; name: string }[]>([]);
    const error = ref('');
    let generation = 0;
    async function refresh() {
        if (!enabled) return;
        const turn = ++generation;
        error.value = '';
        async function all<T>(
            path: string,
            extra: Record<string, string> = {},
        ) {
            const result: T[] = [];
            for (let page = 1; page <= 10000; page++) {
                const { data } = await api.get<Paginated<T>>(path, {
                    params: { page, limit: 100, ...extra },
                });
                if (turn !== generation) return [];
                result.push(...data.data);
                if (!data.data.length || result.length >= data.totalItems)
                    return result;
            }
            throw new Error('Filter list is too large');
        }
        try {
            const [categoryRows, users] = await Promise.all([
                all<CategoryDto>('/categories', { status: 'all' }),
                all<UserView>('/users'),
            ]);
            if (turn !== generation) return;
            categories.value = categoryRows;
            cashiers.value = users.map((user) => ({
                _id: user._id,
                name: user.name,
            }));
        } catch (cause) {
            if (turn === generation)
                error.value = apiErrorText(
                    cause,
                    'Could not load report filters.',
                );
        }
    }
    onMounted(() => void refresh());
    onBeforeUnmount(() => {
        generation++;
    });
    return { categories, cashiers, error, refresh };
}
