import { describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders, CanceledError } from 'axios';
import { STRING_LIMITS } from '@grocery-pos/contracts';
import {
    isBarcode,
    type Match,
    parseScan,
    searchErrorMessage,
    useProductSearch,
} from './product-search';

const MILK: Match = { product: 'p1', EAN: '2000000000015', name: 'milk' };
const MINTS: Match = { product: 'p2', EAN: '2000000000022', name: 'mints' };

function httpError(status: number, data?: unknown) {
    const config = { headers: new AxiosHeaders() };
    return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, {
        status,
        statusText: '',
        data,
        headers: {},
        config,
    });
}

/** A fetch whose calls settle only when the test says so. */
function controlledFetch() {
    const calls: {
        term: string;
        signal: AbortSignal;
        resolve: (m: Match[]) => void;
        reject: (e: unknown) => void;
    }[] = [];
    const fetch = vi.fn(
        (term: string, signal: AbortSignal) =>
            new Promise<Match[]>((resolve, reject) =>
                calls.push({ term, signal, resolve, reject }),
            ),
    );
    return { fetch, calls };
}

describe('parseScan', () => {
    it('splits the <qty>*<query> shorthand', () => {
        expect(parseScan(' 3*milk ', 1)).toEqual({ qty: 3, query: 'milk' });
    });

    it('keeps the default quantity and the whole input otherwise', () => {
        expect(parseScan('milk', 2)).toEqual({ qty: 2, query: 'milk' });
        expect(parseScan('0*milk', 1)).toEqual({ qty: 1, query: '0*milk' });
        expect(parseScan('a*b', 1)).toEqual({ qty: 1, query: 'a*b' });
    });
});

describe('isBarcode', () => {
    it('is true only for exactly 13 digits', () => {
        expect(isBarcode('2000000000015')).toBe(true);
        expect(isBarcode('200000000001')).toBe(false);
        expect(isBarcode('20000000000150')).toBe(false);
        expect(isBarcode('milk')).toBe(false);
    });
});

describe('searchErrorMessage', () => {
    it("uses the server's message", () => {
        expect(
            searchErrorMessage(
                httpError(403, { message: 'Forbidden resource' }),
            ),
        ).toBe('Forbidden resource');
        expect(
            searchErrorMessage(httpError(400, { message: ['a', 'b'] })),
        ).toBe('a, b');
    });

    it('falls back to the status, or to a network message', () => {
        expect(searchErrorMessage(httpError(502))).toBe('Request failed (502)');
        const config = { headers: new AxiosHeaders() };
        expect(
            searchErrorMessage(
                new AxiosError('timeout', 'ECONNABORTED', config),
            ),
        ).toBe('No response from the server');
    });
});

describe('useProductSearch', () => {
    it('keeps the newest results when an older response arrives last', async () => {
        const { fetch, calls } = controlledFetch();
        const search = useProductSearch(fetch);

        const older = search.search('mi');
        const newer = search.search('milk');
        expect(calls[0].signal.aborted).toBe(true);

        calls[1].resolve([MILK]);
        expect(await newer).toEqual([MILK]);

        // The server answered the aborted request anyway.
        calls[0].resolve([MILK, MINTS]);
        expect(await older).toBeNull();

        expect(search.matches.value).toEqual([MILK]);
        expect(search.answeredFor.value).toBe('milk');
    });

    it('ignores a stale failure, too', async () => {
        const { fetch, calls } = controlledFetch();
        const search = useProductSearch(fetch);

        const older = search.search('mi');
        const newer = search.search('milk');
        calls[1].resolve([MILK]);
        await newer;
        calls[0].reject(new CanceledError());
        await older;

        expect(search.error.value).toBeNull();
        expect(search.matches.value).toEqual([MILK]);
    });

    it('reports a failure as an error, not as "no matches"', async () => {
        const search = useProductSearch(() =>
            Promise.reject(httpError(403, { message: 'Forbidden resource' })),
        );

        expect(await search.search('milk')).toBeNull();

        expect(search.error.value).toBe('Forbidden resource');
        expect(search.answeredFor.value).toBe('milk');
    });

    it('does not send a search longer than any product name', async () => {
        const fetch = vi.fn();
        const search = useProductSearch(fetch);

        await search.search('x'.repeat(STRING_LIMITS.PRODUCT_NAME + 1));

        expect(fetch).not.toHaveBeenCalled();
        expect(search.error.value).toMatch(/too long/);
    });

    it('moves the highlight through the matches, wrapping around', async () => {
        const search = useProductSearch(() => Promise.resolve([MILK, MINTS]));
        await search.search('m');
        expect(search.highlightedMatch()).toBeNull();

        search.move(1);
        expect(search.highlightedMatch()).toEqual(MILK);
        search.move(1);
        expect(search.highlightedMatch()).toEqual(MINTS);
        search.move(1);
        expect(search.highlightedMatch()).toEqual(MILK);
        search.move(-1);
        expect(search.highlightedMatch()).toEqual(MINTS);
    });

    it('clears the highlight when new results arrive', async () => {
        const search = useProductSearch(() => Promise.resolve([MILK, MINTS]));
        await search.search('m');
        search.move(1);

        await search.search('mi');

        expect(search.highlighted.value).toBe(-1);
    });
});
