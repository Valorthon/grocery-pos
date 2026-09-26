import { computed, ref } from 'vue';
import { isAxiosError, isCancel } from 'axios';
import {
    BARCODE_LENGTHS,
    type ProductMatch,
    STRING_LIMITS,
} from '@grocery-pos/contracts';
import { apiErrorText } from '@/utils/api-error';

/** One row of `GET /products/matches`. */
export type Match = ProductMatch;

const BARCODE_LENGTH_VALUES: readonly number[] = Object.values(BARCODE_LENGTHS);

/**
 * True for input shaped like a whole barcode: digits only, as long as an
 * EAN-13, UPC-A or EAN-8 (issue #14). The register tries it as an exact
 * `GET /products/:EAN` first. The check digit is not checked: a legacy code
 * saved before #14 may carry a wrong one and must still scan, and a typed
 * fragment of a longer code that misses falls back to the search (#87).
 */
export function isBarcode(query: string): boolean {
    return /^\d+$/.test(query) && BARCODE_LENGTH_VALUES.includes(query.length);
}

/**
 * Splits the register's `<qty>*<query>` shorthand ("3*milk"). Without a
 * valid positive quantity prefix the whole input is the query.
 */
export function parseScan(
    raw: string,
    defaultQty: number,
): { qty: number; query: string } {
    const text = raw.trim();
    const star = text.indexOf('*');
    if (star !== -1) {
        const parsed = parseInt(text.slice(0, star).trim(), 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
            return { qty: parsed, query: text.slice(star + 1).trim() };
        }
    }
    return { qty: defaultQty, query: text };
}

/**
 * Why a search failed, in the server's words where it gave some
 * (`apiErrorText`, issue #18), else its status.
 */
export function searchErrorMessage(error: unknown): string {
    if (!isAxiosError(error)) {
        return error instanceof Error ? error.message : 'Unknown error';
    }
    return apiErrorText(error, `Request failed (${error.response?.status})`);
}

export type FetchMatches = (
    name: string,
    signal: AbortSignal,
) => Promise<Match[]>;

/**
 * Live product search for the register.
 *
 * Only the latest request may write results: each search aborts the one
 * before it and carries a sequence number, so a slow response for "mi"
 * can never overwrite the results for "milk". Failures are kept in
 * `error`, never shown as "no matches".
 *
 * `currentTerm` is what the input asks for right now (read reactively). Until the results
 * answer that term (`settled`), the list on screen belongs to older text,
 * so the highlight cannot move and nothing counts as highlighted: a quick
 * ↓+Enter after retyping must not add an item from the previous list.
 */
export function useProductSearch(
    fetchMatches: FetchMatches,
    currentTerm: () => string,
) {
    const matches = ref<Match[]>([]);
    const error = ref<string | null>(null);
    const loading = ref(false);
    /** The term `matches`/`error` answer; null before any answer. */
    const answeredFor = ref<string | null>(null);
    /** Index into `matches`, or -1 when nothing is highlighted. */
    const highlighted = ref(-1);
    /** True once the results on screen answer the current term. */
    const settled = computed(
        () => !loading.value && answeredFor.value === currentTerm(),
    );

    let seq = 0;
    let inFlight: AbortController | null = null;

    function cancel() {
        seq++;
        inFlight?.abort();
        inFlight = null;
        loading.value = false;
    }

    function reset() {
        cancel();
        matches.value = [];
        error.value = null;
        answeredFor.value = null;
        highlighted.value = -1;
    }

    /**
     * Searches `term`, resolving to the matches, or null when it failed or
     * a newer search superseded it.
     */
    async function search(term: string): Promise<Match[] | null> {
        cancel();
        const mine = seq;
        const controller = new AbortController();
        inFlight = controller;

        if (term.length > STRING_LIMITS.PRODUCT_NAME) {
            matches.value = [];
            highlighted.value = -1;
            error.value = `Search is too long (max ${STRING_LIMITS.PRODUCT_NAME} characters)`;
            answeredFor.value = term;
            return null;
        }

        loading.value = true;
        try {
            const found = await fetchMatches(term, controller.signal);
            if (mine !== seq) return null;
            matches.value = found;
            error.value = null;
            return found;
        } catch (err) {
            if (mine !== seq || isCancel(err)) return null;
            matches.value = [];
            error.value = searchErrorMessage(err);
            return null;
        } finally {
            if (mine === seq) {
                answeredFor.value = term;
                highlighted.value = -1;
                loading.value = false;
                inFlight = null;
            }
        }
    }

    /** Moves the highlight by `delta`, wrapping around the list. */
    function move(delta: number) {
        const count = matches.value.length;
        if (!count || !settled.value) return;
        const from =
            highlighted.value === -1 && delta < 0 ? 0 : highlighted.value;
        highlighted.value = (from + delta + count) % count;
    }

    function highlightedMatch(): Match | null {
        if (!settled.value) return null;
        return matches.value[highlighted.value] ?? null;
    }

    return {
        matches,
        error,
        loading,
        answeredFor,
        settled,
        highlighted,
        search,
        cancel,
        reset,
        move,
        highlightedMatch,
    };
}
