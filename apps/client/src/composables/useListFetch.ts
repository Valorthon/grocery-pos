import { ref } from 'vue';
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
