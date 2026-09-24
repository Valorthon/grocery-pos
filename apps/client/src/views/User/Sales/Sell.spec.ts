import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders } from 'axios';
import { useCartStore } from '@/stores/cart';
import Sell from './Sell.vue';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/axios', () => ({ default: { get, post: vi.fn() } }));

const MILK = { product: 'p1', EAN: '2000000000015', name: 'milk' };
const MINTS = { product: 'p2', EAN: '2000000000022', name: 'mints' };
const PRODUCTS: Record<
    string,
    { _id: string; EAN: string; name: string; price: number }
> = {
    [MILK.EAN]: { _id: 'p1', EAN: MILK.EAN, name: 'milk', price: 9500 },
    [MINTS.EAN]: { _id: 'p2', EAN: MINTS.EAN, name: 'mints', price: 2500 },
};

let app: App | null = null;
let pinia: Pinia;

beforeEach(() => {
    vi.useFakeTimers();
    pinia = createPinia();
    setActivePinia(pinia);
    get.mockReset();
    localStorage.clear();
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
});

function forbidden() {
    const config = { headers: new AxiosHeaders() };
    return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, {
        status: 403,
        statusText: '',
        data: { statusCode: 403, message: 'Forbidden resource' },
        headers: {},
        config,
    });
}

/** Answers `GET /products/:EAN` from PRODUCTS and matches with `matches`. */
function serve(matches: (name: string) => Promise<unknown>) {
    get.mockImplementation(
        (url: string, config?: { params?: { name: string } }) => {
            if (url === '/products/matches') {
                return matches(config!.params!.name).then((data) => ({ data }));
            }
            const product = PRODUCTS[decodeURIComponent(url.split('/').pop()!)];
            return product
                ? Promise.resolve({ data: product })
                : Promise.reject(new Error('not found'));
        },
    );
}

function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Sell);
    app.use(pinia);
    app.mount(host);
}

async function flush() {
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
        await nextTick();
    }
}

function input() {
    return document.querySelector<HTMLInputElement>(
        '[data-testid="scan-input"]',
    )!;
}

/** Types into the scan box and lets the debounced search run. */
async function type(text: string) {
    input().value = text;
    input().dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(300);
    await flush();
}

async function key(name: string) {
    input().dispatchEvent(new KeyboardEvent('keydown', { key: name }));
    await flush();
}

async function pressEnter() {
    input().form!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
}

function text(testId: string) {
    return (
        document.querySelector(`[data-testid="${testId}"]`)?.textContent ?? null
    );
}

function cartNames() {
    return useCartStore().items.map((i) => `${i.quantity}x ${i.name}`);
}

describe('Sell register search', () => {
    it('adds the highlighted match on Enter, not a barcode lookup of the text', async () => {
        serve(() => Promise.resolve([MILK, MINTS]));
        mount();

        await type('mi');
        expect(
            document.querySelectorAll('[data-testid="search-match"]'),
        ).toHaveLength(2);

        await key('ArrowDown');
        await key('ArrowDown');
        await pressEnter();

        expect(cartNames()).toEqual(['1x mints']);
        expect(get).not.toHaveBeenCalledWith('/products/mi');
        expect(input().value).toBe('');
    });

    it('shows a failed search as an error, not as "no item matching"', async () => {
        serve(() => Promise.reject(forbidden()));
        mount();

        await type('milk');

        expect(text('search-error')).toContain(
            "Couldn't search products: Forbidden resource",
        );
        expect(text('search-empty')).toBeNull();
    });

    it('shows "No item matching" only once the search has answered empty', async () => {
        serve(() => Promise.resolve([]));
        mount();

        await type('bread');

        expect(text('search-error')).toBeNull();
        expect(text('search-empty')).toContain('No item matching "bread"');
    });

    it('never lets a slow response for an older query replace newer results', async () => {
        const pending: Record<string, (m: unknown[]) => void> = {};
        serve((name) => new Promise((resolve) => (pending[name] = resolve)));
        mount();

        await type('mi');
        await type('milk');
        pending.milk([MILK]);
        await flush();
        pending.mi([MILK, MINTS]);
        await flush();

        const shown = [
            ...document.querySelectorAll('[data-testid="search-match"]'),
        ].map((el) => el.querySelector('h4')?.textContent?.trim());
        expect(shown).toEqual(['milk']);
    });

    it('adds the only match of a name or partial barcode on Enter', async () => {
        serve((name) => Promise.resolve(name === '00015' ? [MILK] : []));
        mount();

        await type('2*00015');
        await pressEnter();

        expect(cartNames()).toEqual(['2x milk']);
    });

    it('asks the cashier to pick when several items match', async () => {
        serve(() => Promise.resolve([MILK, MINTS]));
        mount();

        await type('mi');
        await pressEnter();

        expect(cartNames()).toEqual([]);
        expect(document.body.textContent).toContain('2 items match "mi"');
    });

    it('looks a full 13-digit barcode up exactly', async () => {
        serve(() => Promise.resolve([]));
        mount();

        input().value = MILK.EAN;
        input().dispatchEvent(new Event('input'));
        await pressEnter();

        expect(get).toHaveBeenCalledWith(`/products/${MILK.EAN}`);
        expect(cartNames()).toEqual(['1x milk']);
    });

    it('adds nothing while the ticket is locked for checkout', async () => {
        serve(() => Promise.resolve([MILK]));
        mount();
        await type('milk');
        await key('ArrowDown');

        useCartStore().lock();
        await pressEnter();

        expect(cartNames()).toEqual([]);
        expect(get).not.toHaveBeenCalledWith(`/products/${MILK.EAN}`);
    });
});
