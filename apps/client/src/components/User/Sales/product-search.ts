import { computed, ref } from 'vue';
import { isAxiosError, isCancel } from 'axios';
import { STRING_LIMITS } from '@grocery-pos/contracts';

/** One row of `GET /products/matches`. */
export interface Match {
    product: string;
    EAN: string;
    name: string;
}

/** Every EAN in the system is exactly 13 digits (see EanCounterService). */
const BARCODE = /^\d{13}$/;

/** True for a full barcode, the only thing sent to `GET /products/:EAN`. */
export function isBarcode(query: string): boolean {
    return BARCODE.test(query);
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

/** Why a search failed, in the server's words where it gave some. */
export function searchErrorMessage(error: unknown): string {
    if (!isAxiosError(error)) {
        return error instanceof Error ? error.message : 'Unknown error';
    }
    if (!error.response) return 'No response from the server';

    const data = error.response.data as { message?: unknown } | undefined;
    const message = data?.message;
    if (typeof message === 'string' && message) return message;
    if (Array.isArray(message) && message.length) return message.join(', ');
    return `Request failed (${error.response.status})`;
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
