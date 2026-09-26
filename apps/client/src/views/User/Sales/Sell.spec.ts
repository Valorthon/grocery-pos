import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders } from 'axios';
import {
    ErrorCode,
    PaymentType,
    type SaleRequest,
    SaleStatus,
} from '@grocery-pos/contracts';
import { type StoredAttempt, useCartStore } from '@/stores/cart';
import { stubMatchMedia } from '@/testing/match-media';
import { anyModalOpen } from '@/components/ui/modal-stack';
import { REGISTER_TOAST_IDLE, useUIStore } from '@/stores/ui';
import Sell from './Sell.vue';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() =>
    vi.fn<(url: string, body: SaleRequest) => Promise<{ data: unknown }>>(),
);
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

/** Mounts the register in a `<main>`, as SellerLayout does. */
function mount() {
    const host = document.createElement('main');
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

/** Lets a closing modal's leave transition finish. */
async function settleTransitions() {
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    await flush();
}

const RECEIPT = {
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
};

/** Rings up milk and pays ₱100 cash: the receipt is left on screen. */
async function completeSale() {
    withMilkOnTicket();
    serve(() => Promise.resolve([]));
    post.mockResolvedValue({ data: RECEIPT });
    mount();
    await clickButton(buttonNamed('Tender & Charge'));
    const amount = document.activeElement as HTMLInputElement;
    amount.value = '100';
    amount.dispatchEvent(new Event('input'));
    amount.form!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
    );
    await settleTransitions();
    expect(dialog('Transaction Complete')).not.toBeNull();
    expect(dialog('Complete Payment')).toBeNull();
    expect(useCartStore().items).toEqual([]);
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
        const discount = buttonNamed('+ Apply Discount');
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
        await completeSale();
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

describe('Sell receipt on screen (issue #22 review, decision 2026-09-25)', () => {
    it('takes the focus on the receipt itself, so Enter alone does nothing', async () => {
        await completeSale();
        const receipt = dialog('Transaction Complete');
        expect(document.activeElement).toBe(receipt);

        await press('Enter');
        await settleTransitions();
        expect(dialog('Transaction Complete')).not.toBeNull();
        expect(get).not.toHaveBeenCalledWith(`/products/${MILK.EAN}`);
    });

    it('starts the next sale with a scan typed on the receipt', async () => {
        await completeSale();

        for (const digit of MILK.EAN) await press(digit);
        const enter = await press('Enter');
        await settleTransitions();

        expect(enter.defaultPrevented).toBe(true);
        expect(dialog('Transaction Complete')).toBeNull();
        expect(get).toHaveBeenCalledWith(`/products/${MILK.EAN}`);
        expect(cartNames()).toEqual(['1x milk']);
        expect(input().value).toBe('');
        expect(document.activeElement).toBe(input());
    });

    it('keeps Next Sale and Escape closing it', async () => {
        await completeSale();
        await clickButton(buttonNamed('Next Sale'));
        await settleTransitions();
        expect(dialog('Transaction Complete')).toBeNull();
        expect(document.activeElement).toBe(input());
        expect(cartNames()).toEqual([]);
    });
});

function withTicket() {
    const cart = useCartStore();
    cart.add(
        { product: 'p1', EAN: MILK.EAN, name: 'milk', unitPrice: 9500 },
        2,
    );
    cart.add(
        { product: 'p2', EAN: MINTS.EAN, name: 'mints', unitPrice: 2500 },
        1,
    );
}

function qtyInputs() {
    return [
        ...document.querySelectorAll<HTMLInputElement>(
            '[data-testid="line-quantity"]',
        ),
    ];
}

function line(index: number) {
    return document.querySelector<HTMLElement>(
        `[data-testid="ticket-line-${index}"]`,
    )!;
}

async function typeQty(el: HTMLInputElement, value: string) {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
    await flush();
}

async function clickLine(index: number) {
    await vi.advanceTimersByTimeAsync(10);
    line(index).querySelector('td')!.click();
    await flush();
}

describe('Sell ticket quantity (#23)', () => {
    it('edits a line quantity directly', async () => {
        withTicket();
        mount();

        await typeQty(qtyInputs()[1], '12');
        expect(cartNames()).toEqual(['2x milk', '12x mints']);
    });

    it.each([
        ['0', 'Must be at least 1'],
        ['-3', 'Must be at least 1'],
        ['1.5', 'Enter a whole number'],
        ['abc', 'Enter a whole number'],
        ['', 'This field is required'],
    ])('refuses %j inline and holds the charge', async (value, message) => {
        withTicket();
        mount();

        const qty = qtyInputs()[0];
        await typeQty(qty, value);

        expect(cartNames()).toEqual(['2x milk', '1x mints']);
        const error = document.querySelector(
            '[data-testid="line-quantity-error"]',
        )!;
        expect(error.textContent).toContain(message);
        expect(qty.getAttribute('aria-invalid')).toBe('true');
        expect(qty.getAttribute('aria-describedby')).toBe(error.id);
        expect(buttonNamed('Tender & Charge').disabled).toBe(true);

        // Escape puts the line's quantity back.
        await press('Escape');
        expect(qty.value).toBe('2');
        expect(
            document.querySelector('[data-testid="line-quantity-error"]'),
        ).toBeNull();
    });

    it('commits with Enter and goes back to the scan box', async () => {
        withTicket();
        mount();
        const qty = qtyInputs()[0];
        qty.focus();
        qty.value = '4';
        qty.dispatchEvent(new Event('input'));
        await press('Enter');
        expect(cartNames()).toEqual(['4x milk', '1x mints']);
        expect(document.activeElement).toBe(input());
    });

    it('F9 while a quantity is being typed charges the typed quantity', async () => {
        withTicket();
        mount();
        const qty = qtyInputs()[1];
        qty.focus();
        qty.value = '3';
        qty.dispatchEvent(new Event('input'));

        await press('F9');
        expect(cartNames()).toEqual(['2x milk', '3x mints']);
        expect(dialog('Complete Payment')?.textContent).toContain('₱265.00');
    });

    it('F4 focuses the quantity of the last line, from the scan box', async () => {
        withTicket();
        mount();
        expect(document.activeElement).toBe(input());

        const event = await press('F4');
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(qtyInputs()[1]);
    });

    it('F4 focuses the quantity of the selected line', async () => {
        withTicket();
        mount();
        await clickLine(0);
        expect(line(0).getAttribute('aria-current')).toBe('true');

        await press('F4');
        expect(document.activeElement).toBe(qtyInputs()[0]);
    });

    it('selects the line just scanned', async () => {
        withTicket();
        serve(() => Promise.resolve([]));
        mount();
        input().value = MILK.EAN;
        input().dispatchEvent(new Event('input'));
        await pressEnter();

        expect(line(0).getAttribute('aria-current')).toBe('true');
        await press('F4');
        expect(document.activeElement).toBe(qtyInputs()[0]);
    });
});

describe('Sell line removal with Undo (decision 2026-09-25)', () => {
    function undoBar() {
        return document.querySelector('[data-testid="undo-bar"]');
    }

    it('Delete removes the selected line at once, and Undo puts it back', async () => {
        withTicket();
        useCartStore().add(
            {
                product: 'p3',
                EAN: '2000000000039',
                name: 'bread',
                unitPrice: 6000,
            },
            3,
        );
        mount();

        await clickLine(1);
        // The clicked line keeps the focus, so Delete reaches it.
        expect(document.activeElement).toBe(line(1));
        const event = await press('Delete');

        expect(event.defaultPrevented).toBe(true);
        expect(cartNames()).toEqual(['2x milk', '3x bread']);
        expect(undoBar()?.textContent).toContain('Removed 1× mints');
        expect(undoBar()?.closest('[aria-live="polite"]')).not.toBeNull();

        await clickButton(buttonNamed('Undo'));
        expect(cartNames()).toEqual(['2x milk', '1x mints', '3x bread']);
        expect(undoBar()).toBeNull();
    });

    it('the trash button removes with Undo too', async () => {
        withTicket();
        mount();
        await clickButton(buttonNamed('Remove milk'));
        expect(cartNames()).toEqual(['1x mints']);

        await clickButton(buttonNamed('Undo'));
        expect(cartNames()).toEqual(['2x milk', '1x mints']);
    });

    it('One less on a single unit removes the line with Undo', async () => {
        withTicket();
        mount();
        await clickButton(buttonNamed('One less mints'));
        expect(cartNames()).toEqual(['2x milk']);
        expect(undoBar()).not.toBeNull();
    });

    it('offers Undo for a few seconds only', async () => {
        withTicket();
        mount();
        await clickButton(buttonNamed('Remove milk'));
        expect(undoBar()).not.toBeNull();

        await vi.advanceTimersByTimeAsync(4900);
        await flush();
        expect(undoBar()).not.toBeNull();

        await vi.advanceTimersByTimeAsync(200);
        await flush();
        expect(undoBar()).toBeNull();
        expect(cartNames()).toEqual(['1x mints']);
    });

    it('Delete never fires while there is text in the scan box', async () => {
        withTicket();
        mount();
        await clickLine(0);
        input().focus();
        await type('mil');

        const event = await press('Delete');
        expect(event.defaultPrevented).toBe(false);
        expect(cartNames()).toEqual(['2x milk', '1x mints']);
        expect(undoBar()).toBeNull();
    });
});

describe('Sell Delete from the empty scan box (#85)', () => {
    function undoBar() {
        return document.querySelector('[data-testid="undo-bar"]');
    }

    it('removes the most recently added line, and Undo puts it back', async () => {
        withTicket();
        mount();
        input().focus();
        expect(input().value).toBe('');

        const event = await press('Delete');
        expect(event.defaultPrevented).toBe(true);
        expect(cartNames()).toEqual(['2x milk']);
        expect(undoBar()?.textContent).toContain('Removed 1× mints');
        // The scan box keeps the focus, so the next scan (or Delete) works.
        expect(document.activeElement).toBe(input());

        await clickButton(buttonNamed('Undo'));
        expect(cartNames()).toEqual(['2x milk', '1x mints']);
    });

    it('goes on removing from the bottom, one line per press', async () => {
        withTicket();
        mount();
        input().focus();

        await press('Delete');
        await press('Delete');
        expect(cartNames()).toEqual([]);
        expect(undoBar()?.textContent).toContain('Removed 2× milk');
        expect((await press('Delete')).defaultPrevented).toBe(false);
    });

    async function scan(EAN: string) {
        input().focus();
        input().value = EAN;
        input().dispatchEvent(new Event('input'));
        await pressEnter();
    }

    it('removes the highlighted line: scan A, scan B, scan A removes A', async () => {
        serve(() => Promise.resolve([]));
        mount();
        await scan(MILK.EAN);
        await scan(MINTS.EAN);
        await scan(MILK.EAN);
        expect(cartNames()).toEqual(['2x milk', '1x mints']);
        // The repeat scan merged into milk in place and highlighted it.
        expect(line(0).getAttribute('aria-current')).toBe('true');
        expect(input().value).toBe('');
        expect(document.activeElement).toBe(input());

        expect((await press('Delete')).defaultPrevented).toBe(true);
        expect(cartNames()).toEqual(['1x mints']);
        expect(undoBar()?.textContent).toContain('Removed 2× milk');

        await clickButton(buttonNamed('Undo'));
        expect(cartNames()).toEqual(['2x milk', '1x mints']);
    });

    it('falls back to the last line when nothing is highlighted', async () => {
        withTicket();
        mount();
        input().focus();

        await press('Delete');
        expect(cartNames()).toEqual(['2x milk']);
    });

    it('ignores an auto-repeated Delete (a held or stuck key)', async () => {
        withTicket();
        mount();
        input().focus();

        const held = await press('Delete', { repeat: true });
        expect(held.defaultPrevented).toBe(false);
        expect(cartNames()).toEqual(['2x milk', '1x mints']);

        // One press, then the repeats while it is held: one line goes.
        await press('Delete');
        await press('Delete', { repeat: true });
        await press('Delete', { repeat: true });
        expect(cartNames()).toEqual(['2x milk']);
    });

    it('ignores Delete during IME composition (the box reads empty)', async () => {
        withTicket();
        mount();
        input().focus();

        const event = await press('Delete', { isComposing: true });
        expect(event.defaultPrevented).toBe(false);
        expect(cartNames()).toEqual(['2x milk', '1x mints']);
    });

    it('edits the text instead while the box has any', async () => {
        withTicket();
        mount();
        input().focus();
        input().value = '4800';
        input().dispatchEvent(new Event('input'));
        await flush();

        const event = await press('Delete');
        expect(event.defaultPrevented).toBe(false);
        expect(cartNames()).toEqual(['2x milk', '1x mints']);
    });

    it('does nothing while a modal is open', async () => {
        withTicket();
        mount();
        await clickButton(buttonNamed('Void Ticket'));
        expect(dialog('Void this ticket')).not.toBeNull();
        // Even with the scan box focused under the dialog.
        input().focus();

        const event = await press('Delete');
        expect(event.defaultPrevented).toBe(false);
        expect(cartNames()).toEqual(['2x milk', '1x mints']);
    });

    it('does nothing while the ticket is locked for checkout', async () => {
        withTicket();
        mount();
        useCartStore().lock();
        await flush();
        input().focus();

        expect((await press('Delete')).defaultPrevented).toBe(false);
        expect(cartNames()).toEqual(['2x milk', '1x mints']);
    });
});

describe('Sell toasts keep clear of the Undo bar (#85)', () => {
    it('raises the toasts while the Undo bar shows, and resets on leaving', async () => {
        withTicket();
        mount();
        const ui = useUIStore();
        expect(ui.registerToast.undoShown).toBe(false);

        await clickButton(buttonNamed('Remove milk'));
        expect(
            document.querySelector('[data-testid="undo-bar"]'),
        ).not.toBeNull();
        expect(ui.registerToast.undoShown).toBe(true);

        await clickButton(buttonNamed('Undo'));
        expect(ui.registerToast.undoShown).toBe(false);

        await clickButton(buttonNamed('Remove milk'));
        expect(ui.registerToast.undoShown).toBe(true);
        app!.unmount();
        app = null;
        expect(ui.registerToast).toEqual(REGISTER_TOAST_IDLE);
    });
});

describe('Sell Void Ticket (decision 2026-09-25)', () => {
    it('asks first, and Keep Ticket keeps it', async () => {
        withTicket();
        mount();

        await clickButton(buttonNamed('Void Ticket'));
        const asked = dialog('Void this ticket (2 lines, 3 items)?');
        expect(asked).not.toBeNull();

        await clickButton(buttonNamed('Keep Ticket'));
        await settleTransitions();
        expect(dialog('Void this ticket')).toBeNull();
        expect(cartNames()).toEqual(['2x milk', '1x mints']);
    });

    it('voids the ticket, its discount and the saved basket once confirmed', async () => {
        const cart = useCartStore();
        cart.setOwner('u-ana');
        withTicket();
        mount();
        await press('F8');
        await clickButton(buttonNamed('10%'));
        expect(
            localStorage.getItem('grocery_pos_cart_v1:u-ana'),
        ).not.toBeNull();

        await clickButton(buttonNamed('Void Ticket'));
        const confirmButton = [
            ...dialog('Void this ticket')!.querySelectorAll('button'),
        ].find((b) => b.textContent?.trim() === 'Void Ticket')!;
        await clickButton(confirmButton);
        await settleTransitions();

        expect(cartNames()).toEqual([]);
        expect(cart.discount).toBeNull();
        expect(localStorage.getItem('grocery_pos_cart_v1:u-ana')).toBeNull();
        expect(document.body.textContent).toContain('+ Apply Discount');
    });
});

describe('Sell Void Ticket counts (#85)', () => {
    it('says "1 line, 1 item" for a single unit', async () => {
        withMilkOnTicket();
        mount();
        await clickButton(buttonNamed('Void Ticket'));
        expect(dialog('Void this ticket (1 line, 1 item)?')).not.toBeNull();
    });

    it('says "1 line, N items" for one line of several units', async () => {
        useCartStore().add(
            { product: 'p1', EAN: MILK.EAN, name: 'milk', unitPrice: 9500 },
            4,
        );
        mount();
        await clickButton(buttonNamed('Void Ticket'));
        expect(dialog('Void this ticket (1 line, 4 items)?')).not.toBeNull();
    });
});

describe('Sell quantity multiplier (decision 2026-09-25)', () => {
    function badge() {
        return (
            document
                .querySelector('[data-testid="multiplier-badge"]')
                ?.textContent?.trim() ?? null
        );
    }

    it('shows the picked multiplier, applies it to one scan, then resets', async () => {
        serve(() => Promise.resolve([]));
        mount();
        expect(badge()).toBeNull();

        const select = document.querySelector<HTMLSelectElement>(
            'select[aria-label="Quantity per scan"]',
        )!;
        select.value = '12';
        select.dispatchEvent(new Event('change'));
        await flush();
        expect(badge()).toBe('×12 on next scan');

        input().value = MILK.EAN;
        input().dispatchEvent(new Event('input'));
        await pressEnter();
        expect(cartNames()).toEqual(['12x milk']);
        expect(badge()).toBeNull();
        expect(select.value).toBe('1');

        input().value = MINTS.EAN;
        input().dispatchEvent(new Event('input'));
        await pressEnter();
        expect(cartNames()).toEqual(['12x milk', '1x mints']);
    });

    it('shows a typed 12* multiplier too', async () => {
        serve(() => Promise.resolve([]));
        mount();
        await type('6*milk');
        expect(badge()).toBe('×6 on next scan');
    });
});

describe('Sell scan feedback (#23)', () => {
    it('announces a success politely, and it fades', async () => {
        serve(() => Promise.resolve([]));
        mount();
        input().value = MILK.EAN;
        input().dispatchEvent(new Event('input'));
        await pressEnter();

        const status = document.querySelector('[data-testid="scan-status"]')!;
        expect(status.getAttribute('aria-live')).toBe('polite');
        expect(status.textContent).toContain('Scanned: milk');

        await vi.advanceTimersByTimeAsync(3000);
        await flush();
        expect(status.textContent?.trim()).toBe('');
    });

    it('announces an error assertively and keeps it until the next scan', async () => {
        serve(() => Promise.resolve([]));
        mount();
        await type('bread');
        await pressEnter();

        const alert = document.querySelector('[data-testid="scan-alert"]')!;
        expect(alert.getAttribute('aria-live')).toBe('assertive');
        expect(alert.getAttribute('role')).toBe('alert');
        expect(alert.textContent).toContain('No item matching "bread"');

        await vi.advanceTimersByTimeAsync(10_000);
        await flush();
        expect(alert.textContent).toContain('No item matching "bread"');

        input().value = MILK.EAN;
        input().dispatchEvent(new Event('input'));
        await pressEnter();
        expect(alert.textContent?.trim()).toBe('');
        expect(cartNames()).toEqual(['1x milk']);
    });
});

describe('Sell barcode lookup errors (#27)', () => {
    function apiError(status: number, error: ErrorCode) {
        const config = { headers: new AxiosHeaders() };
        return new AxiosError(
            'Request failed',
            'ERR_BAD_REQUEST',
            config,
            null,
            {
                status,
                statusText: '',
                data: { statusCode: status, error, message: 'x' },
                headers: {},
                config,
            },
        );
    }

    async function scanUnknown(error: unknown) {
        serve(
            () => Promise.resolve([]),
            () => Promise.reject(error),
        );
        mount();
        input().value = '4006381333931';
        input().dispatchEvent(new Event('input'));
        await pressEnter();
    }

    it('says a barcode is not found when the API answers PRODUCT_NOT_FOUND', async () => {
        await scanUnknown(apiError(404, ErrorCode.PRODUCT_NOT_FOUND));
        expect(text('scan-alert')).toContain(
            'Barcode "4006381333931" not found',
        );
    });

    it('says the lookup failed for any other error', async () => {
        await scanUnknown(apiError(503, ErrorCode.INTERNAL_ERROR));
        expect(text('scan-alert')).toContain('Could not look up that code');
    });
});

describe('Sell barcode-length scans (#87)', () => {
    const UPC_A = '036000291452';
    const EAN_8 = '96385074';
    /** Saved before #14 with a wrong check digit (should end in 1). */
    const LEGACY = '4006381333932';
    /** Longer codes whose 12- and 8-digit prefixes have valid check digits. */
    const LONG_12 = '4801234567088';
    const LONG_8 = '4801243067005';
    type Product = { _id: string; EAN: string; name: string; price: number };
    const STORED: Record<string, Product> = {
        [UPC_A]: { _id: 'p3', EAN: UPC_A, name: 'tissue', price: 4500 },
        [EAN_8]: { _id: 'p4', EAN: EAN_8, name: 'gum', price: 1000 },
        [LEGACY]: { _id: 'p5', EAN: LEGACY, name: 'bread', price: 1999 },
        [LONG_12]: { _id: 'p6', EAN: LONG_12, name: 'soap', price: 3000 },
        [LONG_8]: { _id: 'p7', EAN: LONG_8, name: 'rice', price: 5000 },
    };
    const asMatch = (p: Product) => ({
        product: p._id,
        EAN: p.EAN,
        name: p.name,
    });

    function notFound() {
        const config = { headers: new AxiosHeaders() };
        return new AxiosError(
            'Request failed',
            'ERR_BAD_REQUEST',
            config,
            null,
            {
                status: 404,
                statusText: '',
                data: {
                    statusCode: 404,
                    error: ErrorCode.PRODUCT_NOT_FOUND,
                    message: 'No Product found',
                },
                headers: {},
                config,
            },
        );
    }

    /**
     * Exact lookups answer from STORED; matches are every stored code that
     * starts with the digits, as the API's barcode prefix search would.
     */
    function serveStored() {
        serve(
            (name) =>
                Promise.resolve(
                    Object.values(STORED)
                        .filter((p) => p.EAN.startsWith(name))
                        .map(asMatch),
                ),
            (EAN) =>
                STORED[EAN]
                    ? Promise.resolve(STORED[EAN])
                    : Promise.reject(notFound()),
        );
    }

    async function scan(code: string) {
        input().value = code;
        input().dispatchEvent(new Event('input'));
        await pressEnter();
    }

    function urls() {
        return get.mock.calls.map(([url]) => url as string);
    }

    it.each([
        ['a 12-digit UPC-A', UPC_A, 'tissue'],
        ['an 8-digit EAN-8', EAN_8, 'gum'],
        ['a 13-digit legacy code with a wrong check digit', LEGACY, 'bread'],
    ])(
        'looks %s up exactly and adds it, in one request',
        async (_label, code, name) => {
            serveStored();
            mount();

            await scan(code);

            expect(urls()).toEqual([`/products/${code}`]);
            expect(cartNames()).toEqual([`1x ${name}`]);
            expect(text('scan-status')).toContain(`Scanned: ${name}`);
        },
    );

    it('applies the quantity shorthand to an EAN-8', async () => {
        serveStored();
        mount();

        await scan(`3*${EAN_8}`);

        expect(cartNames()).toEqual(['3x gum']);
    });

    it.each([
        ['12', LONG_12.slice(0, 12), 'soap'],
        ['8', LONG_8.slice(0, 8), 'rice'],
    ])(
        'falls back to the matches for a typed %s-digit prefix that is not a stored code',
        async (_label, prefix) => {
            serveStored();
            mount();

            await scan(prefix);

            // The miss costs exactly one search, nothing more.
            expect(urls()).toEqual([
                `/products/${prefix}`,
                '/products/matches',
            ]);
            expect(cartNames()).toEqual([]);
            expect(text('scan-alert')).not.toContain('not found');
            // Digits are never auto-added, even with one match.
            expect(text('scan-alert')).toContain(
                `1 item matches "${prefix}": pick it`,
            );
            expect(document.getElementById('product-match-0')).not.toBeNull();
        },
    );

    it('lists every match of a prefix that hits several codes', async () => {
        serveStored();
        mount();

        await scan('48012');

        // Not barcode-length: searched only, as before.
        expect(urls()).toEqual(['/products/matches']);
        expect(text('scan-alert')).toContain('2 items match "48012"');
    });

    it.each([
        ['12-digit', '012345678905'],
        ['8-digit', '40170725'],
        ['13-digit wrong-check-digit', '4006381333930'],
    ])(
        'says an unknown %s code is not found when nothing matches either',
        async (_label, code) => {
            serveStored();
            mount();

            await scan(code);

            expect(urls()).toEqual([`/products/${code}`, '/products/matches']);
            expect(cartNames()).toEqual([]);
            expect(text('scan-alert')).toContain(`Barcode "${code}" not found`);
        },
    );

    it('keeps the live search of text retyped while a lookup was missing', async () => {
        let answer!: (value: unknown) => void;
        serve(
            () => Promise.resolve([]),
            () =>
                new Promise((_resolve, reject) => {
                    answer = () => reject(notFound());
                }),
        );
        mount();

        await scan(UPC_A);
        input().value = 'milk';
        input().dispatchEvent(new Event('input'));
        answer(undefined);
        await flush();

        expect(urls()).toEqual([`/products/${UPC_A}`]);
        expect(text('scan-alert')).not.toContain('not found');
    });
});

describe('Sell match list (#22 follow-up)', () => {
    it('scrolls the highlighted match into view', async () => {
        const scroll = vi.fn();
        Element.prototype.scrollIntoView = scroll;
        try {
            serve(() => Promise.resolve([MILK, MINTS]));
            mount();
            await type('mi');
            await key('ArrowDown');
            await key('ArrowDown');
            expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
            expect(scroll.mock.contexts[scroll.mock.contexts.length - 1]).toBe(
                document.getElementById('product-match-1'),
            );
        } finally {
            delete (Element.prototype as Partial<Element>).scrollIntoView;
        }
    });
});

describe('Sell discount (#23)', () => {
    async function openFixed() {
        await press('F8');
        await clickButton(buttonNamed('₱ Amount'));
        return document.querySelector<HTMLInputElement>('#discount-amount')!;
    }

    async function typeText(el: HTMLInputElement, value: string) {
        el.value = value;
        el.dispatchEvent(new Event('input'));
        await flush();
    }

    it('takes a fixed peso amount with a reason and sends it as FIXED centavos', async () => {
        withTicket(); // ₱215.00
        post.mockResolvedValue({
            data: { ...RECEIPT, subtotal: 21500, totalAmount: 20000 },
        });
        mount();

        const amount = await openFixed();
        expect(document.activeElement).toBe(amount);
        await typeText(amount, '15');
        await typeText(
            document.querySelector<HTMLInputElement>('#discount-reason')!,
            ' damaged box ',
        );

        expect(document.body.textContent).toContain(
            'Discount Applied (₱15.00)',
        );
        expect(buttonNamed('Tender & Charge').textContent).toContain('₱200.00');

        await press('F2');
        await press('F9');
        const cash = document.activeElement as HTMLInputElement;
        cash.value = '200';
        cash.dispatchEvent(new Event('input'));
        cash.form!.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
        await settleTransitions();

        const body = post.mock.calls[0][1];
        expect(body.discount).toEqual({
            type: 'FIXED',
            value: 1500,
            reason: 'damaged box',
        });
        expect(body.sellDetails).toEqual([
            { product: 'p1', quantity: 2 },
            { product: 'p2', quantity: 1 },
        ]);
        // No price changed: no notice.
        expect(
            document.querySelector('[data-testid="receipt-notice"]'),
        ).toBeNull();
    });

    it('refuses a fixed amount above the subtotal, as the server does', async () => {
        withTicket();
        mount();
        const amount = await openFixed();
        await typeText(amount, '300');
        await typeText(
            document.querySelector<HTMLInputElement>('#discount-reason')!,
            'x',
        );

        expect(
            document.querySelector('[data-testid="discount-amount-error"]')
                ?.textContent,
        ).toContain("Can't be more than the subtotal (₱215.00)");
        expect(amount.getAttribute('aria-invalid')).toBe('true');
        expect(buttonNamed('Tender & Charge').disabled).toBe(true);
    });

    it('keeps the discount across leaving the register and coming back', async () => {
        withTicket();
        mount();
        await press('F8');
        await clickButton(buttonNamed('10%'));
        const reason =
            document.querySelector<HTMLInputElement>('#discount-reason')!;
        await typeText(reason, 'senior');

        app!.unmount();
        app = null;
        document.body.innerHTML = '';
        mount();

        expect(document.body.textContent).toContain('Discount Applied (10%)');
        expect(
            document.querySelector<HTMLInputElement>('#discount-reason')!.value,
        ).toBe('senior');
        expect(buttonNamed('Tender & Charge').textContent).toContain('₱193.50');
    });

    it('keeps a fixed amount across leaving the register', async () => {
        withTicket();
        mount();
        await typeText(await openFixed(), '15.50');

        app!.unmount();
        app = null;
        document.body.innerHTML = '';
        mount();

        expect(
            document.querySelector<HTMLInputElement>('#discount-amount')!.value,
        ).toBe('15.50');
    });
});

describe('Sell price change notice (#23)', () => {
    it('says so on the receipt when the server charged a different total', async () => {
        withMilkOnTicket();
        serve(() => Promise.resolve([]));
        post.mockResolvedValue({
            data: {
                ...RECEIPT,
                items: [{ productName: 'milk', quantity: 1, amount: 9900 }],
                subtotal: 9900,
                totalAmount: 9900,
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
        await settleTransitions();

        expect(
            document.querySelector('[data-testid="receipt-notice"]')
                ?.textContent,
        ).toContain(
            'Prices changed since scanning; the receipt shows the charged amounts.',
        );
    });

    it('shows no notice when the totals agree', async () => {
        await completeSale();
        expect(
            document.querySelector('[data-testid="receipt-notice"]'),
        ).toBeNull();
    });
});

describe('Sell checkout across a reload (#23 review)', () => {
    function networkError() {
        return new AxiosError('Network Error', 'ERR_NETWORK');
    }

    async function payExactCash() {
        await press('F9');
        const amount = document.activeElement as HTMLInputElement;
        amount.value = '300';
        amount.dispatchEvent(new Event('input'));
        amount.form!.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
        await settleTransitions();
    }

    /** A refresh: the page and the stores start again from localStorage. */
    function reload() {
        app!.unmount();
        app = null;
        document.body.innerHTML = '';
        pinia = createPinia();
        setActivePinia(pinia);
        useCartStore().setOwner('u-ana');
        mount();
    }

    function saved() {
        return JSON.parse(
            localStorage.getItem('grocery_pos_cart_v1:u-ana')!,
        ) as { attempt: StoredAttempt | null };
    }

    it('saves the key with the basket before the sale is sent', async () => {
        useCartStore().setOwner('u-ana');
        withTicket();
        let savedAtSend: unknown = null;
        post.mockImplementation(() => {
            savedAtSend = saved().attempt;
            return new Promise(() => {});
        });
        mount();

        await payExactCash();

        const key = post.mock.calls[0][1].idempotencyKey;
        expect(savedAtSend).toMatchObject({ idempotencyKey: key });
    });

    it('retries with the same key after a reload, and settles on the replayed receipt', async () => {
        useCartStore().setOwner('u-ana');
        withTicket();
        post.mockRejectedValueOnce(networkError());
        mount();
        await payExactCash();
        const firstKey = post.mock.calls[0][1].idempotencyKey;
        expect(dialog('Complete Payment')).not.toBeNull();

        reload();
        expect(cartNames()).toEqual(['2x milk', '1x mints']);

        // The server recorded the first try: it replays that receipt.
        post.mockResolvedValueOnce({
            data: { ...RECEIPT, subtotal: 21500, totalAmount: 21500 },
        });
        await payExactCash();

        expect(post).toHaveBeenCalledTimes(2);
        expect(post.mock.calls[1][1].idempotencyKey).toBe(firstKey);
        expect(dialog('Transaction Complete')).not.toBeNull();
        expect(cartNames()).toEqual([]);
        expect(localStorage.getItem('grocery_pos_cart_v1:u-ana')).toBeNull();
    });

    it('uses a new key when the ticket changed after the reload', async () => {
        useCartStore().setOwner('u-ana');
        withTicket();
        post.mockRejectedValueOnce(networkError());
        mount();
        await payExactCash();
        const firstKey = post.mock.calls[0][1].idempotencyKey;

        reload();
        await clickButton(buttonNamed('Remove mints'));
        post.mockResolvedValueOnce({ data: RECEIPT });
        await press('F9');
        const amount = document.activeElement as HTMLInputElement;
        amount.value = '190';
        amount.dispatchEvent(new Event('input'));
        amount.form!.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
        await settleTransitions();

        expect(post.mock.calls[1][1].idempotencyKey).not.toBe(firstKey);
    });

    it('drops the saved key with the ticket on a void', async () => {
        useCartStore().setOwner('u-ana');
        withTicket();
        post.mockRejectedValueOnce(networkError());
        mount();
        await payExactCash();
        await escape();
        expect(saved().attempt).not.toBeNull();

        await clickButton(buttonNamed('Void Ticket'));
        const confirmVoid = [
            ...dialog('Void this ticket')!.querySelectorAll('button'),
        ].find((b) => b.textContent?.trim() === 'Void Ticket')!;
        await clickButton(confirmVoid);
        await settleTransitions();

        expect(useCartStore().attempt).toBeNull();
        expect(localStorage.getItem('grocery_pos_cart_v1:u-ana')).toBeNull();
    });
});

describe('Sell Delete only on a ticket line (#23 review)', () => {
    it('does nothing from a discount button', async () => {
        withTicket();
        mount();
        await clickLine(0);
        await press('F8');
        expect(document.activeElement?.textContent?.trim()).toBe('None');

        await press('Delete');
        expect(cartNames()).toEqual(['2x milk', '1x mints']);
        expect(document.querySelector('[data-testid="undo-bar"]')).toBeNull();
    });

    it('does nothing from the Qty picker or with nothing focused', async () => {
        withTicket();
        mount();
        await clickLine(0);

        document
            .querySelector<HTMLSelectElement>(
                'select[aria-label="Quantity per scan"]',
            )!
            .focus();
        await press('Delete');
        (document.activeElement as HTMLElement).blur();
        await press('Delete');

        expect(cartNames()).toEqual(['2x milk', '1x mints']);
    });

    it('works on a line button', async () => {
        withTicket();
        mount();
        await clickLine(1);
        buttonNamed('One more mints').focus();
        await press('Delete');
        expect(cartNames()).toEqual(['2x milk']);
    });
});

describe('Sell multiplier on a clicked match (#23 review)', () => {
    it('adds the typed N* quantity when a match is clicked', async () => {
        serve(() => Promise.resolve([MILK]));
        mount();
        await type('12*milk');

        await clickButton(
            document.querySelector<HTMLElement>(
                '[data-testid="search-match"]',
            )!,
        );
        expect(cartNames()).toEqual(['12x milk']);
        expect(
            document.querySelector('[data-testid="multiplier-badge"]'),
        ).toBeNull();
    });

    it('adds the picked quantity when a match is clicked', async () => {
        serve(() => Promise.resolve([MILK]));
        mount();
        const select = document.querySelector<HTMLSelectElement>(
            'select[aria-label="Quantity per scan"]',
        )!;
        select.value = '6';
        select.dispatchEvent(new Event('change'));
        await type('milk');
        await clickButton(
            document.querySelector<HTMLElement>(
                '[data-testid="search-match"]',
            )!,
        );
        expect(cartNames()).toEqual(['6x milk']);
        expect(select.value).toBe('1');
    });
});

describe('Sell quantity cap (#23 review)', () => {
    it('reports a huge multiplier as an error and adds nothing', async () => {
        serve(() => Promise.resolve([]));
        mount();
        input().value = `99999999999999999999*${MILK.EAN}`;
        input().dispatchEvent(new Event('input'));
        await pressEnter();

        expect(cartNames()).toEqual([]);
        expect(text('scan-alert')).toContain("a sale can't exceed");
        expect(text('scan-status')?.trim()).toBe('');
    });

    it('refuses a typed quantity that takes the sale past the limit', async () => {
        withTicket();
        mount();
        await typeQty(qtyInputs()[0], '200000');

        expect(cartNames()).toEqual(['2x milk', '1x mints']);
        expect(
            document.querySelector('[data-testid="line-quantity-error"]')
                ?.textContent,
        ).toContain("a sale can't exceed ₱10,000,000.00");
    });
});

describe('Sell re-review fixes (#23)', () => {
    function basket(items: unknown[], discount: unknown = null) {
        return JSON.stringify({ version: 1, items, discount, attempt: null });
    }

    /** Another tab of the same cashier saved `json` as the basket. */
    async function otherTabSaves(json: string) {
        localStorage.setItem('grocery_pos_cart_v1:u-ana', json);
        window.dispatchEvent(
            new StorageEvent('storage', {
                key: 'grocery_pos_cart_v1:u-ana',
                newValue: json,
            }),
        );
        await flush();
    }

    const MILK_LINE = {
        product: 'p1',
        EAN: MILK.EAN,
        name: 'milk',
        unitPrice: 9500,
        quantity: 2,
    };

    it('Delete removes the line the focus is on, even after tabbing from another', async () => {
        withTicket();
        mount();
        await clickLine(0);
        expect(line(0).getAttribute('aria-current')).toBe('true');

        // Tab onto mints' "One more": that line is now the selected one.
        buttonNamed('One more mints').focus();
        await flush();
        expect(line(1).getAttribute('aria-current')).toBe('true');

        await press('Delete');
        expect(cartNames()).toEqual(['2x milk']);
    });

    it('drops a typed quantity for a line another tab removed, so the charge is not held', async () => {
        useCartStore().setOwner('u-ana');
        withTicket();
        mount();
        await typeQty(qtyInputs()[1], '0');
        expect(buttonNamed('Tender & Charge').disabled).toBe(true);

        await otherTabSaves(basket([MILK_LINE]));

        expect(cartNames()).toEqual(['2x milk']);
        expect(
            document.querySelector('[data-testid="line-quantity-error"]'),
        ).toBeNull();
        expect(buttonNamed('Tender & Charge').disabled).toBe(false);
    });

    it('drops a pending Undo when another tab replaces the basket', async () => {
        useCartStore().setOwner('u-ana');
        withTicket();
        mount();
        await clickButton(buttonNamed('Remove mints'));
        expect(
            document.querySelector('[data-testid="undo-bar"]'),
        ).not.toBeNull();

        await otherTabSaves(basket([MILK_LINE]));
        expect(document.querySelector('[data-testid="undo-bar"]')).toBeNull();
    });

    it('shows a fixed discount another tab set', async () => {
        useCartStore().setOwner('u-ana');
        withTicket();
        mount();

        await otherTabSaves(
            basket([MILK_LINE], {
                type: 'FIXED',
                value: 1500,
                reason: 'loyalty',
            }),
        );

        expect(
            document.querySelector<HTMLInputElement>('#discount-amount')!.value,
        ).toBe('15.00');
        expect(document.body.textContent).toContain(
            'Discount Applied (₱15.00)',
        );
        expect(
            document.querySelector('[data-testid="discount-amount-error"]'),
        ).toBeNull();
    });

    it('says why Undo cannot put a line back past the sale limit', async () => {
        withTicket();
        mount();
        await clickButton(buttonNamed('Remove mints'));
        // Milk now fills the ticket up to the limit.
        const cart = useCartStore();
        cart.setQuantity('p1', cart.maxQuantity('p1', 9500));

        await clickButton(buttonNamed('Undo'));

        expect(cartNames()).toEqual([`${cart.maxQuantity('p1', 9500)}x milk`]);
        const { useUIStore } = await import('@/stores/ui');
        expect(useUIStore().toasts.map((t) => t.lines.join(' '))).toEqual([
            "Couldn't put back 1x mints: a sale can't exceed ₱10,000,000.00.",
        ]);
    });
});

describe('Sell labels (issue #24)', () => {
    it('calls the discount "Discount" everywhere and shows no sales tax line', async () => {
        withTicket(); // ₱215.00
        mount();
        expect(buttonNamed('+ Apply Discount')).toBeTruthy();

        await press('F8');
        expect(
            document
                .querySelector('#discount-options')
                ?.getAttribute('aria-label'),
        ).toBe('Discount');
        await clickButton(buttonNamed('10%'));

        const body = document.body.textContent ?? '';
        expect(body).toContain('Discount Applied (10%)');
        expect(body).toContain('Discount (10%)');
        expect(body).not.toMatch(/Order Discount|Savings/i);
        expect(body).not.toMatch(/tax/i);
    });
});

describe('Sell below lg: sticky footer and tender sheet (#26)', () => {
    let media: ReturnType<typeof stubMatchMedia>;

    beforeEach(() => {
        media = stubMatchMedia(false);
    });

    afterEach(() => media.restore());

    function footer() {
        return document.querySelector<HTMLElement>(
            '[data-testid="tender-footer"]',
        );
    }
    function openButton() {
        return document.querySelector<HTMLButtonElement>(
            '[data-testid="open-tender"]',
        )!;
    }
    function tenderRoot() {
        return document.querySelector<HTMLElement>(
            '[data-testid="tender-root"]',
        )!;
    }
    function panel() {
        return document.querySelector<HTMLElement>(
            '[data-testid="tender-panel"]',
        )!;
    }
    function sheetOpen() {
        return !tenderRoot().classList.contains('hidden');
    }
    /** The 44px touch size (#26): h-11/w-11 or min-h-11/min-w-11. */
    function isTouchSize(el: Element) {
        const c = el.className;
        return /\b(min-)?h-11\b/.test(c) && /\b(min-)?w-11\b/.test(c);
    }

    it('shows the total in a footer, with the tender panel out of the page', async () => {
        withMilkOnTicket();
        mount();
        await flush();

        expect(footer()).not.toBeNull();
        expect(text('footer-total')).toContain('95.00');
        expect(isTouchSize(openButton())).toBe(true);
        // The panel waits under <body>, hidden, not beside the ticket.
        expect(document.querySelector('main')!.contains(panel())).toBe(false);
        expect(tenderRoot().parentElement).toBe(document.body);
        expect(sheetOpen()).toBe(false);
    });

    it('Tender opens the panel as a dialog; Escape closes it', async () => {
        withMilkOnTicket();
        mount();
        await flush();

        await clickButton(openButton());
        expect(sheetOpen()).toBe(true);
        expect(panel().getAttribute('role')).toBe('dialog');
        expect(panel().getAttribute('aria-modal')).toBe('true');
        expect(openButton().getAttribute('aria-expanded')).toBe('true');
        expect(panel().contains(document.activeElement)).toBe(true);
        // The page behind is inert while the sheet is up.
        expect(document.querySelector('main')!.hasAttribute('inert')).toBe(
            true,
        );

        await escape();
        expect(sheetOpen()).toBe(false);
        expect(document.querySelector('main')!.hasAttribute('inert')).toBe(
            false,
        );
        // Back to the scan box, ready for the next scan.
        expect(document.activeElement).toBe(input());
    });

    it('charges from the sheet, and a recorded sale closes it', async () => {
        withMilkOnTicket();
        serve(() => Promise.resolve([]));
        post.mockResolvedValue({ data: RECEIPT });
        mount();
        await flush();

        await clickButton(openButton());
        await clickButton(buttonNamed('Tender & Charge'));
        expect(dialog('Complete Payment')).not.toBeNull();
        const amount = document.activeElement as HTMLInputElement;
        amount.value = '100';
        amount.dispatchEvent(new Event('input'));
        amount.form!.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
        await settleTransitions();

        expect(dialog('Transaction Complete')).not.toBeNull();
        expect(sheetOpen()).toBe(false);
    });

    it('F9 opens the sheet first, then the checkout over it', async () => {
        withMilkOnTicket();
        mount();
        await flush();

        const event = await press('F9');
        expect(event.defaultPrevented).toBe(true);
        expect(sheetOpen()).toBe(true);
        expect(dialog('Complete Payment')).not.toBeNull();
        expect(document.activeElement?.getAttribute('aria-label')).toBe(
            'Amount tendered',
        );

        // Closing the checkout goes back to the sheet, not the ticket.
        await escape();
        expect(dialog('Complete Payment')).toBeNull();
        expect(sheetOpen()).toBe(true);
    });

    it('F9 in the open sheet charges', async () => {
        withMilkOnTicket();
        mount();
        await flush();
        await clickButton(openButton());

        await press('F9');
        expect(dialog('Complete Payment')).not.toBeNull();
    });

    it('F8 opens the sheet with the focus on the discount', async () => {
        withMilkOnTicket();
        mount();
        await flush();

        await press('F8');
        expect(sheetOpen()).toBe(true);
        expect(document.activeElement?.textContent?.trim()).toBe('None');
        const chips = [
            ...document.querySelectorAll('#discount-options button'),
        ];
        expect(chips.length).toBeGreaterThan(0);
        expect(chips.every(isTouchSize)).toBe(true);
    });

    it('F2 from the sheet goes back to the scan box', async () => {
        withMilkOnTicket();
        mount();
        await flush();
        await clickButton(openButton());

        await press('F2');
        expect(sheetOpen()).toBe(false);
        expect(document.activeElement).toBe(input());
    });

    it('Delete does nothing while the sheet is on top (#85)', async () => {
        withTicket();
        mount();
        await flush();
        await clickButton(openButton());
        expect(sheetOpen()).toBe(true);

        expect((await press('Delete')).defaultPrevented).toBe(false);
        // Nor after trying to focus the empty scan box behind it (the
        // sheet's trap keeps the focus; deleteTarget refuses anyway).
        input().focus();
        expect((await press('Delete')).defaultPrevented).toBe(false);
        expect(cartNames()).toEqual(['2x milk', '1x mints']);
        expect(sheetOpen()).toBe(true);

        // Closed again, the empty scan box removes the last line.
        await press('F2');
        expect(sheetOpen()).toBe(false);
        expect((await press('Delete')).defaultPrevented).toBe(true);
        expect(cartNames()).toEqual(['2x milk']);
    });

    it('tells the toasts to go to the top while the sheet is open (#85)', async () => {
        withMilkOnTicket();
        mount();
        await flush();
        const ui = useUIStore();
        expect(ui.registerToast.sheetOpen).toBe(false);

        await clickButton(openButton());
        expect(ui.registerToast.sheetOpen).toBe(true);

        await press('F2');
        expect(ui.registerToast.sheetOpen).toBe(false);
    });

    it('F4 from the sheet goes back to the line quantity', async () => {
        withMilkOnTicket();
        mount();
        await flush();
        await clickButton(openButton());

        await press('F4');
        expect(sheetOpen()).toBe(false);
        expect(document.activeElement?.getAttribute('data-testid')).toBe(
            'line-quantity',
        );
    });

    it('growing to lg puts the panel beside the ticket again', async () => {
        withMilkOnTicket();
        mount();
        await flush();
        await clickButton(openButton());

        media.set(true);
        await settleTransitions();

        expect(footer()).toBeNull();
        expect(document.querySelector('main')!.contains(panel())).toBe(true);
        expect(panel().hasAttribute('role')).toBe(false);
        expect(document.querySelector('main')!.hasAttribute('inert')).toBe(
            false,
        );
    });

    it('ticket line controls are 44px touch targets', async () => {
        withMilkOnTicket();
        mount();
        await flush();

        for (const name of ['One less milk', 'One more milk', 'Remove milk']) {
            expect(isTouchSize(buttonNamed(name))).toBe(true);
        }
    });

    function active() {
        return document.activeElement as HTMLElement | null;
    }

    it('shrinking below lg with the focus in the panel opens the sheet on that field', async () => {
        media.set(true);
        withMilkOnTicket();
        mount();
        await flush();
        await press('F8');
        await clickButton(buttonNamed('5%'));
        expect(active()?.id).toBe('discount-reason');

        media.set(false);
        await settleTransitions();

        expect(sheetOpen()).toBe(true);
        expect(panel().getAttribute('role')).toBe('dialog');
        expect(active()?.id).toBe('discount-reason');
        // A key typed now stays in the field, not the scan box.
        await press('a');
        expect(active()?.id).toBe('discount-reason');
    });

    it('shrinking with the focus elsewhere leaves the sheet closed', async () => {
        media.set(true);
        withMilkOnTicket();
        mount();
        await flush();
        expect(active()).toBe(input());

        media.set(false);
        await settleTransitions();

        expect(sheetOpen()).toBe(false);
    });

    it('growing to lg keeps the focus on the field being typed in', async () => {
        withMilkOnTicket();
        mount();
        await flush();
        await press('F8');
        await clickButton(buttonNamed('5%'));
        const reason = active() as HTMLInputElement;
        expect(reason.id).toBe('discount-reason');
        reason.value = 'loyalty';
        reason.dispatchEvent(new Event('input'));
        await flush();

        media.set(true);
        await settleTransitions();

        expect(document.querySelector('main')!.contains(panel())).toBe(true);
        expect(active()).toBe(reason);
        expect(reason.value).toBe('loyalty');
        expect(anyModalOpen.value).toBe(false);
    });

    it('growing to lg keeps the focus on a panel button until the next key', async () => {
        withMilkOnTicket();
        mount();
        await flush();
        await press('F8');
        expect(active()?.textContent?.trim()).toBe('None');

        media.set(true);
        await settleTransitions();

        // Not sent back to the opener (the scan box) nor taken by it.
        expect(active()?.textContent?.trim()).toBe('None');
        // A scan afterwards still lands in the scan box.
        await press('7');
        expect(active()).toBe(input());
    });

    it('unmounting with the sheet open leaves no modal behind', async () => {
        withMilkOnTicket();
        mount();
        await flush();
        await clickButton(openButton());
        expect(anyModalOpen.value).toBe(true);

        app!.unmount();
        app = null;

        expect(anyModalOpen.value).toBe(false);
        expect(document.querySelector('[inert]')).toBeNull();
        expect(document.body.style.overflow).toBe('');
    });

    it('F9 does nothing while the receipt is showing', async () => {
        withMilkOnTicket();
        serve(() => Promise.resolve([]));
        post.mockResolvedValue({ data: RECEIPT });
        mount();
        await flush();
        await press('F9');
        const amount = active() as HTMLInputElement;
        amount.value = '100';
        amount.dispatchEvent(new Event('input'));
        amount.form!.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
        await settleTransitions();
        expect(dialog('Transaction Complete')).not.toBeNull();

        // Something on the ticket again (e.g. another tab), then F9.
        withMilkOnTicket();
        await flush();
        await press('F9');

        expect(dialog('Complete Payment')).toBeNull();
        expect(sheetOpen()).toBe(false);
        expect(dialog('Transaction Complete')).not.toBeNull();
    });
});

describe('Sell at lg (#26)', () => {
    it('has no footer: the panel sits beside the ticket', () => {
        withMilkOnTicket();
        mount();

        expect(
            document.querySelector('[data-testid="tender-footer"]'),
        ).toBeNull();
        const panel = document.querySelector('[data-testid="tender-panel"]')!;
        expect(document.querySelector('main')!.contains(panel)).toBe(true);
        expect(panel.hasAttribute('role')).toBe(false);
    });
});

describe('Sell scan box on phones (#89)', () => {
    function classes(el: Element) {
        return el.className.split(/\s+/);
    }

    it('hides the F2 hint below sm and keeps it from sm up', async () => {
        mount();
        await flush();

        const hint = document.querySelector('[data-testid="scan-key-hint"]')!;
        expect(classes(hint)).toEqual(
            expect.arrayContaining(['hidden', 'sm:inline-flex']),
        );
        expect(hint.querySelector('[data-key-hint]')?.textContent).toBe('F2');
    });

    it('gives the text the room the buttons leave, with and without Clear', async () => {
        serve(() => Promise.resolve([]));
        mount();
        await flush();

        // Empty: Enter / Scan (and the F2 hint from sm) on the right.
        expect(classes(input())).toEqual(
            expect.arrayContaining(['pr-32', 'sm:pr-48']),
        );
        expect(classes(input())).not.toContain('pr-48');
        expect(classes(input())).not.toContain('sm:pr-52');

        // With text, Clear shows too, and the padding makes room for it
        // at every width: the cluster is ~203px from sm up (> pr-48).
        await type('milk');
        expect(classes(input())).toEqual(
            expect.arrayContaining(['pr-43', 'sm:pr-52']),
        );
        expect(classes(input())).not.toContain('pr-32');
        expect(classes(input())).not.toContain('sm:pr-48');
        const clear = document.querySelector(
            'button[aria-label="Clear search"]',
        )!;
        const scan = [...document.querySelectorAll('button')].find((b) =>
            b.textContent?.includes('Enter / Scan'),
        )!;
        const qty = document.querySelector('select[aria-label^="Quantity"]')!;
        for (const control of [clear, scan, qty]) {
            expect(classes(control)).toEqual(
                expect.arrayContaining(['min-h-11', 'min-w-11']),
            );
        }
    });
});
