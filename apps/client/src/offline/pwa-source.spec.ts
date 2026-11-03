/// <reference types="node" />
import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { offlineWorkerSource, registerOfflineWorker } from './pwa-source';
function worker() {
    const handlers = new Map<string, (event: unknown) => void>();
    const match = vi.fn().mockResolvedValue('cached shell');
    const addAll = vi.fn().mockResolvedValue(undefined);
    const cache = { match, addAll };
    const caches = {
        open: vi.fn().mockResolvedValue(cache),
        keys: vi
            .fn()
            .mockResolvedValue([
                'grocery-pos-shell-old',
                'grocery-pos-shell-version',
                'unrelated-api-cache',
            ]),
        delete: vi.fn().mockResolvedValue(true),
    };
    const fetch = vi.fn().mockResolvedValue('network response');
    const claim = vi.fn().mockResolvedValue(undefined);
    const self = {
        location: { origin: 'https://pos.test' },
        clients: { claim },
        addEventListener: (name: string, callback: (event: unknown) => void) =>
            handlers.set(name, callback),
    };
    class TestRequest {
        constructor(
            readonly url: string,
            readonly init: unknown,
        ) {}
    }
    runInNewContext(
        offlineWorkerSource(['/index.html', '/assets/app-hash.js'], 'version'),
        { self, caches, fetch, Request: TestRequest, URL },
    );
    return { handlers, match, addAll, caches, fetch, claim };
}
afterEach(() => vi.unstubAllGlobals());
it('preloads only the explicit public shell and does not force an active checkout update', async () => {
    const w = worker();
    let work: Promise<void> | undefined;
    w.handlers.get('install')!({
        waitUntil: (p: Promise<void>) => {
            work = p;
        },
    });
    await work;
    expect(w.addAll).toHaveBeenCalledWith([
        expect.objectContaining({ url: '/index.html' }),
        expect.objectContaining({ url: '/assets/app-hash.js' }),
    ]);
});
it('cleans only old shell caches, preserving unrelated caches', async () => {
    const w = worker();
    let work: Promise<void> | undefined;
    w.handlers.get('activate')!({
        waitUntil: (p: Promise<void>) => {
            work = p;
        },
    });
    await work;
    expect(w.caches.delete).toHaveBeenCalledExactlyOnceWith(
        'grocery-pos-shell-old',
    );
    expect(w.claim).toHaveBeenCalled();
});
it.each([
    { url: 'https://api.test/v1/sales', method: 'GET', mode: 'cors' },
    { url: 'https://pos.test/v1/sales', method: 'POST', mode: 'cors' },
    {
        url: 'https://pos.test/v1/auth/refresh',
        method: 'GET',
        mode: 'navigate',
    },
    { url: 'https://pos.test/health', method: 'GET', mode: 'navigate' },
    { url: 'https://pos.test/sales', method: 'GET', mode: 'cors' },
])('never caches API/auth/non-public request $url', (request) => {
    const w = worker();
    const respondWith = vi.fn();
    w.handlers.get('fetch')!({ request, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
});
it('falls back to the cached index only for a failed app navigation', async () => {
    const w = worker();
    w.fetch.mockRejectedValue(new Error('offline'));
    let work: Promise<unknown> | undefined;
    w.handlers.get('fetch')!({
        request: {
            url: 'https://pos.test/seller/register',
            method: 'GET',
            mode: 'navigate',
        },
        respondWith: (p: Promise<unknown>) => {
            work = p;
        },
    });
    expect(await work).toBe('cached shell');
});
it('serves a cached hashed asset, with network fallback only if it is absent', async () => {
    const w = worker();
    let work: Promise<unknown> | undefined;
    const event = {
        request: {
            url: 'https://pos.test/assets/app-hash.js',
            method: 'GET',
            mode: 'cors',
        },
        respondWith: (p: Promise<unknown>) => {
            work = p;
        },
    };
    w.handlers.get('fetch')!(event);
    expect(await work).toBe('cached shell');
    w.match.mockResolvedValue(undefined);
    w.handlers.get('fetch')!(event);
    expect(await work).toBe('network response');
});
it('registers safely when supported and leaves online POS available on failure', async () => {
    vi.stubGlobal('navigator', {});
    await registerOfflineWorker();
    const register = vi.fn().mockResolvedValue({});
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    await registerOfflineWorker();
    expect(register).toHaveBeenCalledWith('/sw.js', { updateViaCache: 'none' });
    register.mockRejectedValue(new Error('storage unavailable'));
    await expect(registerOfflineWorker()).resolves.toBeUndefined();
});
