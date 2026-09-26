import { computed, onBeforeUnmount, ref } from 'vue';
import { type ProductMatch, STRING_LIMITS } from '@grocery-pos/contracts';
import api from '@/axios';
import type { ComboboxOption } from '@/components/ui/types';

export const SEARCH_FAILED = 'Could not search products. Try again.';

/** How long typing must pause before the search request goes out. */
export const SEARCH_DEBOUNCE_MS = 500;

/**
 * The product search behind the restock and adjustment comboboxes (issue
 * #17). A failed request clears the matches, stops the spinner and shows
 * `error` instead of leaving a permanent spinner and an unhandled
 * rejection. Only the latest query's answer is kept, so a slow earlier
 * response never replaces newer matches.
 */
export function useProductMatches() {
    const matches = ref<ProductMatch[]>([]);
    const loading = ref(false);
    const error = ref('');
    let latest = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /** Each option's value is the product id; picking writes back its EAN. */
    const options = computed<ComboboxOption[]>(() =>
        matches.value.map((m) => ({
            value: m.product,
            label: m.name,
            subtitle: `EAN: ${m.EAN}`,
            display: m.EAN,
        })),
    );

    async function search(query: string): Promise<void> {
        const term = query.trim();
        const request = ++latest;
        error.value = '';
        if (!term) {
            matches.value = [];
            loading.value = false;
            return;
        }
        loading.value = true;
        // The API reads a digits-only `EAN` as a barcode prefix of at most
        // 13 digits; longer digit strings still match as a name fragment.
        const params =
            /^\d+$/.test(term) && term.length <= STRING_LIMITS.EAN
                ? { EAN: term }
                : { name: term.toUpperCase() };
        try {
            const result = await api.get<ProductMatch[]>('products/matches', {
                params,
            });
            if (request !== latest) return;
            matches.value = result.data;
        } catch {
            if (request !== latest) return;
            matches.value = [];
            error.value = SEARCH_FAILED;
        } finally {
            if (request === latest) loading.value = false;
        }
    }

    function debouncedSearch(query: string): void {
        if (timer) clearTimeout(timer);
        if (!query.trim()) {
            void search('');
            return;
        }
        timer = setTimeout(() => void search(query), SEARCH_DEBOUNCE_MS);
    }

    /** Forgets the matches, e.g. when a dialog reopens. */
    function reset(): void {
        if (timer) clearTimeout(timer);
        latest++;
        matches.value = [];
        loading.value = false;
        error.value = '';
    }

    onBeforeUnmount(() => {
        if (timer) clearTimeout(timer);
    });

    return { matches, options, loading, error, search, debouncedSearch, reset };
}
