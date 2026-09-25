import { type Ref, ref, watch } from 'vue';
import { apiErrorText } from '@/utils/api-error';

/**
 * Loading and error state for a list fetch (issue #18). `request` fetches
 * and `apply` writes the result into the view; a failure in either one
 * (a server error, no network, or a malformed row) ends up in `error`,
 * and `loading` always ends. The view shows `error` in place of its rows
 * with a Retry that calls `load` again (BaseTable's `error` and `retry`).
 *
 * Only the latest call may write: a slower, older response is dropped.
 */
export function useListFetch<T>(
    request: () => Promise<T>,
    apply: (result: T) => void,
    fallback = 'Could not load the list.',
) {
    const loading = ref(false);
    const error = ref('');
    let latest = 0;

    async function load(): Promise<void> {
        const call = ++latest;
        loading.value = true;
        error.value = '';
        try {
            const result = await request();
            if (call === latest) apply(result);
        } catch (err) {
            if (call === latest) error.value = apiErrorText(err, fallback);
        } finally {
            if (call === latest) loading.value = false;
        }
    }

    return { loading, error, load };
}

/**
 * Page and page size of a server-paged list (issue #20). Every change
 * loads exactly once:
 *
 * - a new page loads that page;
 * - a new page size goes back to page 1 (page 4 of 5 rows is past the end
 *   at 50 rows);
 * - `search()`, for a filter change, goes back to page 1 and loads.
 *
 * Going back to page 1 from another page loads through the page watcher,
 * so `search()` never loads twice. `load` is read lazily, so it may be the
 * `useListFetch` loader declared after this.
 */
export function useListPaging(load: () => unknown, initialLimit = 5) {
    const page = ref(1);
    const limit = ref(initialLimit);

    function search(): void {
        if (page.value === 1) void load();
        else page.value = 1;
    }

    watch(page, () => void load());
    watch(limit, search);

    return { page, limit, search };
}

/**
 * The search filters a list was last loaded with (issue #20). `read`
 * takes the live inputs; `apply()` snapshots them into `applied` and
 * searches. Requests read `applied`, so paging, a page-size change and
 * Retry never send text that was typed but not searched yet.
 */
export function useAppliedFilters<T>(read: () => T, search: () => void) {
    const applied = ref(read()) as Ref<T>;

    function apply(): void {
        applied.value = read();
        search();
    }

    return { applied, apply };
}
