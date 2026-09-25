import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { NETWORK_ERROR_MESSAGE } from '@/utils/api-error';
import { useAppliedFilters, useListFetch, useListPaging } from './useListFetch';

function httpError(status: number, message: string): AxiosError {
    const config = { headers: new AxiosHeaders() };
    return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, {
        status,
        statusText: '',
        headers: {},
        config,
        data: { statusCode: status, message },
    } as AxiosResponse);
}

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('useListFetch (issue #18)', () => {
    it('loads, applies the result and ends loading', async () => {
        const apply = vi.fn();
        const list = useListFetch(() => Promise.resolve([1, 2]), apply);

        const done = list.load();
        expect(list.loading.value).toBe(true);
        await done;

        expect(apply).toHaveBeenCalledWith([1, 2]);
        expect(list.loading.value).toBe(false);
        expect(list.error.value).toBe('');
    });

    it("shows the server's message and ends loading on failure", async () => {
        const list = useListFetch(
            () => Promise.reject(httpError(500, 'Internal server error')),
            vi.fn(),
        );

        await list.load();

        expect(list.loading.value).toBe(false);
        expect(list.error.value).toBe('Internal server error');
    });

    it('reports a network failure', async () => {
        const config = { headers: new AxiosHeaders() };
        const list = useListFetch(
            () =>
                Promise.reject(
                    new AxiosError('Network Error', 'ERR_NETWORK', config, {}),
                ),
            vi.fn(),
        );

        await list.load();

        expect(list.error.value).toBe(NETWORK_ERROR_MESSAGE);
    });

    it('catches a malformed row (a non-axios error) with the fallback', async () => {
        const list = useListFetch(
            () => Promise.resolve([{ restockedBy: null }]),
            (rows: Array<{ restockedBy: { name: string } | null }>) => {
                rows.map((r) => r.restockedBy!.name);
            },
            'Could not load restocks.',
        );

        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        await list.load();

        expect(list.error.value).toBe('Could not load restocks.');
        expect(list.loading.value).toBe(false);
        expect(log).toHaveBeenCalledWith(expect.any(TypeError));
    });

    it('clears the error when a retry succeeds', async () => {
        const request = vi
            .fn()
            .mockRejectedValueOnce(httpError(503, 'Unavailable'))
            .mockResolvedValueOnce(['row']);
        const apply = vi.fn();
        const list = useListFetch(request, apply);

        await list.load();
        expect(list.error.value).toBe('Unavailable');

        await list.load();
        expect(list.error.value).toBe('');
        expect(apply).toHaveBeenCalledWith(['row']);
    });

    it('drops an older success that lands after a newer one', async () => {
        const first = deferred<string>();
        const second = deferred<string>();
        const request = vi
            .fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const apply = vi.fn();
        const list = useListFetch(request, apply);

        const a = list.load();
        const b = list.load();
        second.resolve('page 2');
        await b;
        first.resolve('page 1');
        await a;

        expect(apply.mock.calls).toEqual([['page 2']]);
        expect(list.loading.value).toBe(false);
    });

    it('stays loading until the newest call settles', async () => {
        const first = deferred<string>();
        const second = deferred<string>();
        const request = vi
            .fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const list = useListFetch(request, vi.fn());

        const a = list.load();
        const b = list.load();
        first.resolve('page 1');
        await a;
        expect(list.loading.value).toBe(true);

        second.resolve('page 2');
        await b;
        expect(list.loading.value).toBe(false);
    });

    it('drops an older response that lands after a newer one', async () => {
        const first = deferred<string>();
        const second = deferred<string>();
        const request = vi
            .fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const apply = vi.fn();
        const list = useListFetch(request, apply);

        const a = list.load();
        const b = list.load();
        second.resolve('page 2');
        await b;
        first.reject(httpError(500, 'late failure'));
        await a;

        expect(apply).toHaveBeenCalledTimes(1);
        expect(apply).toHaveBeenCalledWith('page 2');
        expect(list.error.value).toBe('');
        expect(list.loading.value).toBe(false);
    });
});

describe('useListPaging (issue #20)', () => {
    async function settle() {
        for (let i = 0; i < 3; i++) await nextTick();
    }

    it('loads a new page', async () => {
        const load = vi.fn();
        const paging = useListPaging(load);

        paging.page.value = 3;
        await settle();

        expect(load).toHaveBeenCalledTimes(1);
    });

    it('goes back to page 1 when the page size changes, loading once', async () => {
        const load = vi.fn();
        const paging = useListPaging(load);
        paging.page.value = 4;
        await settle();
        load.mockClear();

        paging.limit.value = 50;
        await settle();

        expect(paging.page.value).toBe(1);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('loads once for a page size change on page 1', async () => {
        const load = vi.fn();
        const paging = useListPaging(load);

        paging.limit.value = 25;
        await settle();

        expect(load).toHaveBeenCalledTimes(1);
    });

    it('searches from page 1 with a single load, from any page', async () => {
        const load = vi.fn();
        const paging = useListPaging(load);

        paging.search();
        await settle();
        expect(load).toHaveBeenCalledTimes(1);

        paging.page.value = 3;
        await settle();
        load.mockClear();

        paging.search();
        await settle();
        expect(paging.page.value).toBe(1);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('starts at page 1 with the given page size', () => {
        const paging = useListPaging(vi.fn(), 10);

        expect(paging.page.value).toBe(1);
        expect(paging.limit.value).toBe(10);
    });
});

describe('useAppliedFilters (issue #20)', () => {
    it('keeps the last applied inputs until apply() runs again', () => {
        const name = ref('');
        const search = vi.fn();
        const filters = useAppliedFilters(() => ({ name: name.value }), search);
        expect(filters.applied.value).toEqual({ name: '' });

        name.value = 'milk';
        expect(filters.applied.value).toEqual({ name: '' });
        expect(search).not.toHaveBeenCalled();

        filters.apply();
        expect(filters.applied.value).toEqual({ name: 'milk' });
        expect(search).toHaveBeenCalledTimes(1);

        name.value = 'bread';
        expect(filters.applied.value).toEqual({ name: 'milk' });
    });
});
