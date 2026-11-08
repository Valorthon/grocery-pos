import { afterEach, expect, it, vi } from 'vitest';
import { type App, createApp, h, nextTick, ref } from 'vue';
import { DiscountType, PaymentType } from '@grocery-pos/contracts';
import RegisterScanBox from './RegisterScanBox.vue';
import RegisterMatches from './RegisterMatches.vue';
import RegisterTicket from './RegisterTicket.vue';
import RegisterTenderPanel from './RegisterTenderPanel.vue';

// The register's parts (#163) only render props and report actions; the
// behaviour itself is covered through Sell.spec.ts.

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

function mount(render: () => ReturnType<typeof h>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({ render });
    app.mount(host);
}

const q = <T extends Element = HTMLElement>(selector: string) =>
    document.querySelector<T & HTMLElement>(selector)!;

it('scan box: two-way query and multiplier, actions emitted, input exposed', async () => {
    const query = ref('');
    const multiplier = ref(1);
    const box = ref<{ input: HTMLInputElement | null } | null>(null);
    const on = {
        submit: vi.fn(),
        searchChange: vi.fn(() => query.value),
        move: vi.fn(),
        unhighlight: vi.fn(),
        clear: vi.fn(),
        multiplierChange: vi.fn(),
    };
    mount(() =>
        h(RegisterScanBox, {
            ref: box,
            modelValue: query.value,
            'onUpdate:modelValue': (v: string) => (query.value = v),
            multiplier: multiplier.value,
            'onUpdate:multiplier': (v: number) => (multiplier.value = v),
            locked: false,
            qtyOptions: [1, 2, 3],
            matchCount: 2,
            highlighted: 1,
            nextScanQty: 3,
            scanFeedback: { type: 'error', message: 'Nope' },
            onSubmit: on.submit,
            onSearchChange: on.searchChange,
            onMove: on.move,
            onUnhighlight: on.unhighlight,
            onClear: on.clear,
            onMultiplierChange: on.multiplierChange,
        }),
    );
    const input = q<HTMLInputElement>('[data-testid="scan-input"]');
    expect(box.value?.input).toBe(input);
    expect(input.getAttribute('aria-activedescendant')).toBe('product-match-1');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(q('[data-testid="multiplier-badge"]').textContent).toContain('×3');
    expect(q('[data-testid="scan-alert"]').textContent).toContain('Nope');

    input.value = 'milk';
    input.dispatchEvent(new Event('input'));
    // The query is updated before the search is asked to run.
    expect(on.searchChange).toHaveReturnedWith('milk');
    await nextTick();
    expect(input.className).toContain('pr-43');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(on.move.mock.calls).toEqual([[1], [-1]]);
    expect(on.unhighlight).toHaveBeenCalledOnce();

    q<HTMLButtonElement>('[aria-label="Clear search"]').click();
    expect(on.clear).toHaveBeenCalledOnce();

    const select = q<HTMLSelectElement>('select');
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    expect(multiplier.value).toBe(3);
    expect(on.multiplierChange).toHaveBeenCalledOnce();

    input.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(on.submit).toHaveBeenCalledOnce();
});

it('matches: lists, highlights and reports a pick; empty and error states', async () => {
    const onSelect = vi.fn();
    const state = ref({
        matches: [
            { product: 'p1', EAN: '2000000000015', name: 'milk' },
            { product: 'p2', EAN: '2000000000022', name: 'mints' },
        ],
        error: null as string | null,
        settled: true,
    });
    mount(() =>
        h(RegisterMatches, {
            ...state.value,
            highlighted: 1,
            term: 'mi',
            locked: false,
            onSelect,
        }),
    );
    const options = document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="search-match"]',
    );
    expect(options).toHaveLength(2);
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    options[0].click();
    expect(onSelect).toHaveBeenCalledWith(state.value.matches[0]);

    state.value = { matches: [], error: null, settled: true };
    await nextTick();
    expect(q('[data-testid="search-empty"]').textContent).toContain('"mi"');

    state.value = { matches: [], error: 'down', settled: true };
    await nextTick();
    expect(q('[data-testid="search-error"]').textContent).toContain('down');
});

it('ticket: renders lines and drafts, reports every line action', () => {
    const item = {
        product: 'p1',
        EAN: '2000000000015',
        name: 'milk',
        unitPrice: 9500,
        quantity: 2,
    };
    const setLineEl = vi.fn();
    const setQtyEl = vi.fn();
    const on = Object.fromEntries(
        [
            'onVoid',
            'onSelect',
            'onLineClick',
            'onMove',
            'onIncrement',
            'onDecrement',
            'onQtyInput',
            'onQtyCommit',
            'onQtyEnter',
            'onQtyCancel',
            'onRemove',
            'onUndo',
        ].map((name) => [name, vi.fn()]),
    );
    mount(() =>
        h(RegisterTicket, {
            items: [item],
            totalUnits: 2,
            locked: false,
            selectedLine: 'p1',
            qtyDrafts: { p1: '0' },
            qtyErrors: { p1: 'Must be at least 1' },
            undo: { item: { ...item, product: 'p9', name: 'eggs' }, index: 1 },
            setLineEl,
            setQtyEl,
            ...on,
        }),
    );
    const line = q('[data-testid="ticket-line-0"]');
    const qty = q<HTMLInputElement>('[data-testid="line-quantity"]');
    expect(setLineEl).toHaveBeenCalledWith('p1', line);
    expect(setQtyEl).toHaveBeenCalledWith('p1', qty);
    expect(line.getAttribute('aria-current')).toBe('true');
    expect(qty.value).toBe('0');
    expect(q('[data-testid="line-quantity-error"]').id).toBe('qty-error-0');
    expect(q('[data-testid="undo-bar"]').textContent).toContain('eggs');

    line.click();
    expect(on.onLineClick).toHaveBeenCalledWith('p1', expect.any(MouseEvent));
    line.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(on.onMove).toHaveBeenCalledWith(1);
    qty.dispatchEvent(new FocusEvent('focus'));
    expect(on.onSelect).toHaveBeenCalledWith('p1');
    qty.dispatchEvent(new Event('input'));
    expect(on.onQtyInput).toHaveBeenCalledWith('p1', expect.any(Event));
    qty.dispatchEvent(new Event('change'));
    expect(on.onQtyCommit).toHaveBeenCalledWith('p1');
    qty.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(on.onQtyEnter).toHaveBeenCalledWith('p1');
    qty.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(on.onQtyCancel).toHaveBeenCalledWith('p1');

    q<HTMLButtonElement>('[aria-label="One more milk"]').click();
    expect(on.onIncrement).toHaveBeenCalledWith(item);
    q<HTMLButtonElement>('[aria-label="One less milk"]').click();
    expect(on.onDecrement).toHaveBeenCalledWith(item);
    q<HTMLButtonElement>('[aria-label="Remove milk"]').click();
    expect(on.onRemove).toHaveBeenCalledWith('p1');
    [...document.querySelectorAll('button')]
        .find((b) => b.textContent?.trim() === 'Void Ticket')!
        .click();
    expect(on.onVoid).toHaveBeenCalledOnce();
    [...document.querySelectorAll('button')]
        .find((b) => b.textContent?.trim() === 'Undo')!
        .click();
    expect(on.onUndo).toHaveBeenCalledOnce();
});

it('tender panel: discount and charge actions, fields exposed', async () => {
    const reason = ref('');
    const fixed = ref('');
    const panel = ref<{
        discountOptionsEl: HTMLElement | null;
        fixedInput: HTMLInputElement | null;
        reasonInput: HTMLInputElement | null;
    } | null>(null);
    const on = {
        onClose: vi.fn(),
        onToggleDiscount: vi.fn(),
        onApplyDiscount: vi.fn(),
        onCheckout: vi.fn(),
    };
    mount(() =>
        h(RegisterTenderPanel, {
            ref: panel,
            isLarge: false,
            locked: false,
            offline: false,
            showDiscount: true,
            discountOptions: [0, 5],
            discountChoice: DiscountType.FIXED,
            discountLabel: '₱5.00',
            discountAmount: 500,
            fixedErrorShown: '',
            needsReason: true,
            totalUnits: 2,
            subtotal: 10000,
            total: 9500,
            canCheckout: true,
            fixedText: fixed.value,
            'onUpdate:fixedText': (v: string) => (fixed.value = v),
            discountReason: reason.value,
            'onUpdate:discountReason': (v: string) => (reason.value = v),
            ...on,
        }),
    );
    await nextTick();
    expect(panel.value?.reasonInput).toBe(q('#discount-reason'));
    expect(panel.value?.fixedInput).toBe(q('#discount-amount'));
    expect(panel.value?.discountOptionsEl).toBe(q('#discount-options'));
    expect(q('#discount-reason').className).toContain('border-red-300');

    const reasonInput = q<HTMLInputElement>('#discount-reason');
    reasonInput.value = 'loyalty';
    reasonInput.dispatchEvent(new Event('input'));
    expect(reason.value).toBe('loyalty');

    q<HTMLButtonElement>('[data-testid="close-tender"]').click();
    expect(on.onClose).toHaveBeenCalledOnce();
    q<HTMLButtonElement>('[aria-controls="discount-options"]').click();
    expect(on.onToggleDiscount).toHaveBeenCalledOnce();
    const buttons = [...document.querySelectorAll('button')];
    buttons.find((b) => b.textContent?.trim() === '5%')!.click();
    buttons.find((b) => b.textContent?.trim() === '₱ Amount')!.click();
    expect(on.onApplyDiscount.mock.calls).toEqual([[5], [DiscountType.FIXED]]);
    buttons.find((b) => b.textContent?.includes('Tender & Charge'))!.click();
    buttons.find((b) => b.textContent?.includes('Split Payment'))!.click();
    expect(on.onCheckout.mock.calls).toEqual([
        [PaymentType.CASH],
        [PaymentType.SPLIT],
    ]);
});
