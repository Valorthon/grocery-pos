import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { useSalesLookups } from './useSalesLookups';
import { flush } from '@/testing/form-dom';
import type { ApiGet } from '@/testing/api-mock';
const api = vi.hoisted(() => ({ get: vi.fn<ApiGet>() }));
vi.mock('@/axios', () => ({ default: api }));
let app: App | null = null;
let lookup: ReturnType<typeof useSalesLookups>;
async function mount(enabled = true) {
    app = createApp({
        setup() {
            lookup = useSalesLookups(enabled);
            return () => null;
        },
    });
    app.mount(document.createElement('div'));
    await flush();
}
beforeEach(() => {
    api.get.mockImplementation(async (url) => ({
        data: {
            data: [{ _id: url, name: url, isActive: false }],
            totalItems: 1,
        },
    }));
});
afterEach(() => {
    app?.unmount();
    app = null;
});
it('never queries management lookups from a seller history view', async () => {
    await mount(false);
    expect(api.get).not.toHaveBeenCalled();
    await lookup.refresh();
    expect(api.get).not.toHaveBeenCalled();
});
it('loads all pages and keeps inactive names available in historical filters', async () => {
    api.get.mockImplementation(async (url, config) => ({
        data: {
            data: [
                {
                    _id: `${url}${String(config?.params?.page)}`,
                    name: url,
                    isActive: false,
                },
            ],
            totalItems: 2,
        },
    }));
    await mount();
    expect(lookup.categories.value).toHaveLength(2);
    expect(lookup.cashiers.value).toHaveLength(2);
    expect(lookup.error.value).toBe('');
});
it('handles empty pages rather than continuing indefinitely for an inconsistent count', async () => {
    api.get.mockResolvedValue({ data: { data: [], totalItems: 999 } });
    await mount();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(lookup.categories.value).toEqual([]);
});
it('shows lookup errors and retries without retaining an error', async () => {
    api.get.mockRejectedValueOnce(new Error('offline'));
    await mount();
    expect(lookup.error.value).toContain('Could not load report filters');
    await lookup.refresh();
    expect(lookup.error.value).toBe('');
    expect(lookup.categories.value).toHaveLength(1);
});
it('drops responses after unmount and newer retries', async () => {
    let resolve!: (v: { data: unknown }) => void;
    api.get.mockImplementation(
        () =>
            new Promise((yes) => {
                resolve = yes;
            }),
    );
    await mount();
    app?.unmount();
    app = null;
    resolve({ data: { data: [{ _id: 'stale' }], totalItems: 1 } });
    await flush();
    expect(lookup.categories.value).toEqual([]);
});
