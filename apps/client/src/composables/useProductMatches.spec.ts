import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h } from 'vue';
import {
    SEARCH_DEBOUNCE_MS,
    SEARCH_FAILED,
    useProductMatches,
} from './useProductMatches';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

const MILK = { EAN: '4800361002516', name: 'BEAR BRAND MILK', product: 'p1' };

let app: App | null = null;

function setup() {
    let result!: ReturnType<typeof useProductMatches>;
    app = createApp({
        setup() {
            result = useProductMatches();
            return () => h('div');
        },
    });
    app.mount(document.createElement('div'));
    return result;
}

beforeEach(() => api.get.mockReset());
afterEach(() => {
    app?.unmount();
    app = null;
    vi.useRealTimers();
});

describe('useProductMatches (#17)', () => {
    it('maps matches to options keyed by product id', async () => {
        api.get.mockResolvedValue({ data: [MILK] });
        const m = setup();
        await m.search('bear');
        expect(api.get).toHaveBeenCalledWith('products/matches', {
            params: { name: 'BEAR' },
        });
        expect(m.options.value).toEqual([
            {
                value: 'p1',
                label: 'BEAR BRAND MILK',
                subtitle: 'EAN: 4800361002516',
                display: '4800361002516',
            },
        ]);
        expect(m.loading.value).toBe(false);
    });

    it('searches digits as a barcode prefix, up to the EAN length', async () => {
        api.get.mockResolvedValue({ data: [] });
        const m = setup();
        await m.search('4800');
        expect(api.get).toHaveBeenLastCalledWith('products/matches', {
            params: { EAN: '4800' },
        });
        await m.search('12345678901234');
        expect(api.get).toHaveBeenLastCalledWith('products/matches', {
            params: { name: '12345678901234' },
        });
    });

    it('stops the spinner and shows an error when the search fails', async () => {
        api.get.mockRejectedValue(new Error('Network Error'));
        const m = setup();
        await expect(m.search('bear')).resolves.toBeUndefined();
        expect(m.loading.value).toBe(false);
        expect(m.matches.value).toEqual([]);
        expect(m.error.value).toBe(SEARCH_FAILED);

        api.get.mockResolvedValue({ data: [MILK] });
        await m.search('bear');
        expect(m.error.value).toBe('');
        expect(m.matches.value).toEqual([MILK]);
    });

    it('keeps only the latest answer when responses arrive out of order', async () => {
        let resolveSlow!: (v: unknown) => void;
        api.get
            .mockReturnValueOnce(new Promise((r) => (resolveSlow = r)))
            .mockResolvedValueOnce({ data: [MILK] });
        const m = setup();
        const slow = m.search('be');
        await m.search('bear');
        resolveSlow({ data: [{ ...MILK, product: 'stale' }] });
        await slow;
        expect(m.matches.value).toEqual([MILK]);
        expect(m.loading.value).toBe(false);
    });

    it('debounces typing and clears at once on a blank query', async () => {
        vi.useFakeTimers();
        api.get.mockResolvedValue({ data: [MILK] });
        const m = setup();
        m.debouncedSearch('b');
        m.debouncedSearch('be');
        expect(api.get).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
        expect(api.get).toHaveBeenCalledTimes(1);
        expect(m.matches.value).toEqual([MILK]);

        m.debouncedSearch('');
        await vi.advanceTimersByTimeAsync(0);
        expect(m.matches.value).toEqual([]);
        expect(m.loading.value).toBe(false);
    });
});
