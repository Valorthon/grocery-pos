import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders } from 'axios';
import { PaymentType, SaleStatus } from '@grocery-pos/contracts';
import { useCartStore } from '@/stores/cart';
import Sell from './Sell.vue';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/axios', () => ({ default: { get, post } }));

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
    post.mockReset();
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
/**
 * Answers `GET /products/matches` with `matches`, and `GET /products/:EAN`
 * with `lookup` (default: straight from PRODUCTS).
 */
function serve(
    matches: (name: string) => Promise<unknown>,
    lookup: (EAN: string) => Promise<unknown> = (EAN) =>
        PRODUCTS[EAN]
            ? Promise.resolve(PRODUCTS[EAN])
            : Promise.reject(new Error('not found')),
) {
    get.mockImplementation(
        (url: string, config?: { params?: { name: string } }) => {
            if (url === '/products/matches') {
                return matches(config!.params!.name).then((data) => ({ data }));
            }
            return lookup(decodeURIComponent(url.split('/').pop()!)).then(
                (data) => ({ data }),
            );
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

    it('adds the only match of a name on Enter', async () => {
        serve((name) => Promise.resolve(name === 'milk' ? [MILK] : []));
        mount();

        await type('2*milk');
        await pressEnter();

        expect(cartNames()).toEqual(['2x milk']);
    });

    it('never auto-adds the only match of a digits-only fragment', async () => {
        // e.g. the tail of a scan that lost its first digits.
        serve((name) => Promise.resolve(name === '00022' ? [MINTS] : []));
        mount();

        await type('2*00022');
        await pressEnter();

        expect(cartNames()).toEqual([]);
        expect(document.body.textContent).toContain(
            '1 item matches "00022": pick it with ↓ and Enter',
        );

        await key('ArrowDown');
        await pressEnter();

        expect(cartNames()).toEqual(['2x mints']);
    });

    it('keeps the next scan typed while a barcode lookup was in flight', async () => {
        let answer!: (p: unknown) => void;
        serve(
            () => Promise.resolve([]),
            () => new Promise((resolve) => (answer = resolve)),
        );
        mount();

        input().value = MILK.EAN;
        input().dispatchEvent(new Event('input'));
        await pressEnter();

        // The scanner starts the next barcode before milk comes back.
        input().value = '20000';
        input().dispatchEvent(new Event('input'));
        answer(PRODUCTS[MILK.EAN]);
        await flush();

        expect(cartNames()).toEqual(['1x milk']);
        expect(input().value).toBe('20000');
    });

    it('will not add from the previous list after a quick retype', async () => {
        serve((name) =>
            name === 'milk' ? Promise.resolve([MILK]) : new Promise(() => {}),
        );
        mount();
        await type('milk');
        expect(
            document.querySelectorAll('[data-testid="search-match"]'),
        ).toHaveLength(1);

        // Retype and press ↓+Enter before "eggs" has been answered.
        input().value = 'eggs';
        input().dispatchEvent(new Event('input'));
        await key('ArrowDown');
        await pressEnter();

        expect(cartNames()).toEqual([]);
        expect(get).not.toHaveBeenCalledWith(`/products/${MILK.EAN}`);
    });

    it('reports a double Enter once, not as a failed search', async () => {
        const pending: ((m: unknown[]) => void)[] = [];
        serve(() => new Promise((resolve) => pending.push(resolve)));
        mount();

        input().value = 'bread';
        input().dispatchEvent(new Event('input'));
        await pressEnter();
        await pressEnter();
        pending[1]([]);
        await flush();
        pending[0]([]);
        await flush();

        expect(document.body.textContent).not.toContain(
            "Couldn't search products",
        );
        expect(document.body.textContent).toContain('No item matching "bread"');
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

/** Presses `name` where the focus is, as the keyboard would. */
async function press(name: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', {
        key: name,
        bubbles: true,
        cancelable: true,
        ...init,
    });
    (document.activeElement ?? document.body).dispatchEvent(event);
    await flush();
    return event;
}

function buttonNamed(name: string) {
    const found = [...document.querySelectorAll('button')].find(
        (b) =>
            b.getAttribute('aria-label') === name ||
            b.textContent?.trim().startsWith(name),
    );
    if (!found) throw new Error(`No button "${name}"`);
    return found;
}

/** A click as the mouse makes it: the button takes the focus first. */
async function clickButton(button: HTMLElement) {
    // Vue drops an event older than a listener attached after it; with the
    // clock frozen, a click would look as old as the page's own listener.
    await vi.advanceTimersByTimeAsync(10);
    button.focus();
    button.click();
    await flush();
}

/** Escape, then lets the closing modal's leave transition finish. */
async function escape() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    await flush();
}

function dialog(title: string) {
    return (
        [...document.querySelectorAll('[role="dialog"]')].find((d) =>
            d.textContent?.includes(title),
        ) ?? null
    );
}

function withMilkOnTicket() {
    useCartStore().add(
        { product: 'p1', EAN: MILK.EAN, name: 'milk', unitPrice: 9500 },
        1,
    );
}

describe('Sell register keyboard (issue #22)', () => {
    it('F2 puts the focus in the scan box, from anywhere', async () => {
        withMilkOnTicket();
        mount();
        buttonNamed('Void Ticket').focus();

        const event = await press('F2');
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(input());
    });

    it('F8 opens the discount with the focus on the current choice', async () => {
        withMilkOnTicket();
        mount();
        expect(document.querySelector('#discount-options')).toBeNull();

        await press('F8');
        const options = document.querySelector('#discount-options')!;
        expect(options).not.toBeNull();
        expect(document.activeElement?.textContent?.trim()).toBe('None');
        expect(document.activeElement?.getAttribute('aria-pressed')).toBe(
            'true',
        );
    });

    it('F9 opens Tender & Charge with the focus in the amount', async () => {
        withMilkOnTicket();
        mount();

        const event = await press('F9');
        expect(event.defaultPrevented).toBe(true);
        expect(dialog('Complete Payment')).not.toBeNull();
        expect(document.activeElement?.getAttribute('aria-label')).toBe(
            'Amount tendered',
        );
    });

    it('F9 does nothing on an empty ticket', async () => {
        mount();
        await press('F9');
        expect(dialog('Complete Payment')).toBeNull();
    });

    it('leaves F5 (refresh) and modified keys to the browser', async () => {
        withMilkOnTicket();
        mount();
        expect((await press('F5')).defaultPrevented).toBe(false);
        expect((await press('F9', { ctrlKey: true })).defaultPrevented).toBe(
            false,
        );
        expect(dialog('Complete Payment')).toBeNull();
    });

    it('ignores the register keys while a modal is open', async () => {
        withMilkOnTicket();
        mount();
        await press('F9');
        const amount = document.activeElement;

        expect((await press('F8')).defaultPrevented).toBe(false);
        expect(document.querySelector('#discount-options')).toBeNull();
        await press('F2');
        expect(document.activeElement).toBe(amount);
    });

    it('shows the keys on the buttons', async () => {
        withMilkOnTicket();
        mount();
        const charge = buttonNamed('Tender & Charge');
        expect(charge.getAttribute('aria-keyshortcuts')).toBe('F9');
        expect(charge.querySelector('kbd')?.textContent).toBe('F9');
        const discount = buttonNamed('+ Apply Order Discount');
        expect(discount.getAttribute('aria-keyshortcuts')).toBe('F8');
        expect(discount.querySelector('kbd')?.textContent).toBe('F8');
        expect(input().getAttribute('aria-keyshortcuts')).toBe('F2');
    });
});

describe('Sell sticky scan box (issue #22)', () => {
    it('comes back to the scan box after a ticket button is clicked', async () => {
        withMilkOnTicket();
        mount();

        await clickButton(buttonNamed('One more milk'));
        expect(useCartStore().items[0].quantity).toBe(2);
        expect(document.activeElement).toBe(input());
    });

    it('comes back after a click on an empty spot of the ticket', async () => {
        withMilkOnTicket();
        mount();
        (document.activeElement as HTMLElement).blur();
        document.querySelector('table')!.click();
        await flush();
        expect(document.activeElement).toBe(input());
    });

    it('sends a scan typed while a button has the focus to the scan box', async () => {
        withMilkOnTicket();
        mount();
        buttonNamed('One more milk').focus();

        await press('4');
        expect(document.activeElement).toBe(input());

        // Space still presses a focused button.
        buttonNamed('One more milk').focus();
        await press(' ');
        expect(document.activeElement).toBe(buttonNamed('One more milk'));
    });

    it('never takes the focus from the discount reason being typed', async () => {
        withMilkOnTicket();
        mount();
        await press('F8');
        await clickButton(buttonNamed('10%'));

        const reason =
            document.querySelector<HTMLInputElement>('#discount-reason')!;
        // Picking a discount goes straight to its required reason.
        expect(document.activeElement).toBe(reason);

        reason.click();
        await flush();
        await press('a');
        expect(document.activeElement).toBe(reason);
    });

    it('comes back after a modal closes, even when its opener was a button', async () => {
        withMilkOnTicket();
        mount();
        await clickButton(buttonNamed('Tender & Charge'));
        expect(dialog('Complete Payment')).not.toBeNull();

        await escape();
        expect(dialog('Complete Payment')).toBeNull();
        expect(document.activeElement).toBe(input());
    });

    it('comes back after the receipt is closed with Escape', async () => {
        withMilkOnTicket();
        post.mockResolvedValue({
            data: {
                _id: 's1',
                createdAt: '2026-09-25T00:00:00.000Z',
                status: SaleStatus.COMPLETED,
                paymentType: PaymentType.CASH,
                referenceNumber: null,
                tenders: [{ type: 'CASH', amount: 10000 }],
                amountTendered: 10000,
                changeGiven: 500,
                cashierName: 'ana',
                items: [{ productName: 'milk', quantity: 1, amount: 9500 }],
                subtotal: 9500,
                discount: null,
                totalAmount: 9500,
            },
        });
        mount();
        await clickButton(buttonNamed('Tender & Charge'));
        const amount = document.activeElement as HTMLInputElement;
        amount.value = '100';
        amount.dispatchEvent(new Event('input'));
        amount.form!.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
        await flush();
        await vi.advanceTimersByTimeAsync(500);
        await flush();

        expect(dialog('Transaction Complete')).not.toBeNull();
        expect(dialog('Complete Payment')).toBeNull();
        // Enter on the receipt starts the next sale.
        expect(document.activeElement?.textContent?.trim()).toBe('Next Sale');

        await escape();
        expect(dialog('Transaction Complete')).toBeNull();
        expect(document.activeElement).toBe(input());
    });
});

describe('Sell scan box after the other controls (issue #22 review)', () => {
    it('goes back to the scan box once a multiplier is picked', async () => {
        mount();
        const select = document.querySelector<HTMLSelectElement>(
            'select[aria-label="Quantity per scan"]',
        )!;
        select.focus();
        select.value = '6';
        select.dispatchEvent(new Event('change'));
        await flush();

        expect(document.activeElement).toBe(input());
        // The next scan now lands in the box, not as type-ahead on the select.
        expect(select.value).toBe('6');
    });

    it('takes a scan typed while a link has the focus', async () => {
        mount();
        const link = document.createElement('a');
        link.href = '#';
        document.body.appendChild(link);
        link.focus();

        await press('4');
        expect(document.activeElement).toBe(input());
    });
});
