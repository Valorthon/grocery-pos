import { describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { NETWORK_ERROR_MESSAGE } from '@/utils/api-error';
import { useListFetch } from './useListFetch';

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

        await list.load();

        expect(list.error.value).toBe('Could not load restocks.');
        expect(list.loading.value).toBe(false);
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
