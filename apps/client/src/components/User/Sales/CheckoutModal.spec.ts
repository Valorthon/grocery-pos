import { afterEach, describe, expect, it, vi } from 'vitest';
import { inFooter } from '@/testing/form-dom';
import { type App, createApp, h, nextTick, ref } from 'vue';
import { type PaymentRequest, PaymentType } from '@grocery-pos/contracts';
import CheckoutModal from './CheckoutModal.vue';
import { quickCashAmounts } from './checkout';
import { centavosToPesoInput, formatCurrency } from '@/utils/currency';

const TOTAL = 45000;

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

/** Mounts the modal open, with exact cash pre-filled so Confirm is enabled. */
function mount(
    submit: (payment: PaymentRequest) => Promise<unknown>,
    props: Record<string, unknown> = {},
) {
    const open = ref(true);
    const host = document.createElement('div');
    document.body.appendChild(host);

    app = createApp({
        render: () =>
            h(CheckoutModal, {
                modelValue: open.value,
                'onUpdate:modelValue': (v: boolean) => (open.value = v),
                total: TOTAL,
                initialMethod: PaymentType.CASH,
                initialCash: TOTAL,
                submit,
                ...props,
            }),
    });
    app.mount(host);
    return { open };
}

function confirmButton() {
    return document.querySelector<HTMLButtonElement>(
        '[data-testid="checkout-confirm"]',
    )!;
}

function errorText() {
    return (
        document.querySelector('[data-testid="checkout-error"]')?.textContent ??
        null
    );
}

async function flush() {
    for (let i = 0; i < 5; i++) await nextTick();
}

function amountInput() {
    return document.querySelector<HTMLInputElement>(
        'input[aria-label="Amount tendered"]',
    )!;
}

/**
 * Enter in a field. jsdom has no implicit form submission, so this fires
 * the `submit` the browser would; that Enter really submits (through the
 * footer's Confirm, joined by its `form` attribute) is in the PR's manual
 * keyboard checks.
 */
async function pressEnter() {
    amountInput().form!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
    );
    await flush();
}

async function escape() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
}

describe('CheckoutModal', () => {
    it('stays open with a spinner until the sale is recorded, then closes', async () => {
        let settle!: () => void;
        const submit = vi.fn(
            () => new Promise<void>((resolve) => (settle = resolve)),
        );
        const { open } = mount(submit);
        await flush();

        confirmButton().click();
        await flush();

        expect(submit).toHaveBeenCalledWith({
            paymentType: PaymentType.CASH,
            tenders: [{ type: 'CASH', amount: TOTAL }],
        });
        expect(open.value).toBe(true);
        expect(confirmButton().disabled).toBe(true);
        expect(confirmButton().querySelector('.animate-spin')).not.toBe(null);

        // Back is disabled and the header close button is gone mid-request.
        const buttons = [...document.querySelectorAll('button')];
        const back = buttons.find((b) => b.textContent?.trim() === 'Back');
        expect(back?.disabled).toBe(true);
        expect(
            buttons.some(
                (b) => b !== confirmButton() && b.textContent?.trim() === '',
            ),
        ).toBe(false);

        settle();
        await flush();
        expect(open.value).toBe(false);
    });

    it('stays open on failure, shows the error and retries', async () => {
        const submit = vi
            .fn()
            .mockRejectedValueOnce(
                new Error(
                    'The tendered amount does not cover the total. Review the ticket and the total, then retry.',
                ),
            )
            .mockResolvedValueOnce(undefined);
        const { open } = mount(submit);
        await flush();

        confirmButton().click();
        await flush();

        expect(open.value).toBe(true);
        expect(errorText()).toContain(
            'The tendered amount does not cover the total',
        );
        expect(confirmButton().textContent).toContain('Retry');
        expect(confirmButton().disabled).toBe(false);

        confirmButton().click();
        await flush();

        expect(submit).toHaveBeenCalledTimes(2);
        expect(open.value).toBe(false);
    });

    describe('keyboard (issue #22)', () => {
        it('puts the focus in the amount tendered', async () => {
            mount(vi.fn(), { initialCash: null });
            await flush();
            expect(document.activeElement).toBe(amountInput());
        });

        it('confirms with Enter once the payment is valid, and not before', async () => {
            const submit = vi.fn().mockResolvedValue(undefined);
            const { open } = mount(submit, { initialCash: null });
            await flush();

            await pressEnter();
            expect(submit).not.toHaveBeenCalled();
            expect(open.value).toBe(true);

            amountInput().value = '500';
            amountInput().dispatchEvent(new Event('input'));
            await pressEnter();
            expect(submit).toHaveBeenCalledTimes(1);
            expect(open.value).toBe(false);
        });

        it('confirms through the form: the button submits it and shows Enter', async () => {
            mount(vi.fn());
            await flush();
            const button = confirmButton();
            expect(button.type).toBe('submit');
            expect(button.form).toBe(amountInput().form);
            expect(button.getAttribute('aria-keyshortcuts')).toBe('Enter');
            expect(button.querySelector('kbd')?.textContent).toBe('Enter');
        });

        it('submits once for a double Enter', async () => {
            const submit = vi.fn(() => new Promise(() => {}));
            mount(submit);
            await flush();
            await pressEnter();
            await pressEnter();
            expect(submit).toHaveBeenCalledTimes(1);
        });

        it('cancels with Escape, but not while the sale is processing', async () => {
            let settle!: () => void;
            const submit = vi.fn(
                () => new Promise<void>((resolve) => (settle = resolve)),
            );
            const { open } = mount(submit);
            await flush();

            await pressEnter();
            await escape();
            expect(open.value).toBe(true);

            settle();
            await flush();
            expect(open.value).toBe(false);

            open.value = true;
            await flush();
            await escape();
            expect(open.value).toBe(false);
        });

        it('moves the focus to the field of a newly picked method', async () => {
            mount(vi.fn());
            await flush();
            const gcash = document.querySelector<HTMLButtonElement>(
                `[role="radio"][data-method="${PaymentType.GCASH}"]`,
            )!;
            gcash.click();
            await flush();
            expect(document.activeElement?.getAttribute('aria-label')).toBe(
                'GCash reference number',
            );
        });

        it('puts the focus back in the tender field after a failed sale', async () => {
            let fail!: (e: Error) => void;
            const submit = vi.fn(
                () => new Promise((_, reject) => (fail = reject)),
            );
            mount(submit);
            await flush();

            await pressEnter();
            // A browser silently drops the focus of a field its fieldset
            // disables, to <body>; jsdom does not, so move it there.
            const swallow = (e: Event) => e.stopPropagation();
            document.addEventListener('focusin', swallow, true);
            const away = document.body.appendChild(
                document.createElement('button'),
            );
            away.focus();
            away.remove();
            document.removeEventListener('focusin', swallow, true);
            expect(document.activeElement).toBe(document.body);
            fail(new Error('Could not record the sale'));
            await flush();

            expect(errorText()).toContain('Could not record the sale');
            expect(inFooter('checkout-error')).toBe(true);
            expect(document.activeElement).toBe(amountInput());
        });
    });
    describe('tendering (#23)', () => {
        function methodButton(name: string) {
            return [...document.querySelectorAll('button')].find(
                (b) => b.textContent?.replace(/F\d+\s*$/, '').trim() === name,
            )!;
        }

        function field(label: string) {
            return document.querySelector<HTMLInputElement>(
                `input[aria-label="${label}"]`,
            );
        }

        async function typeInto(el: HTMLInputElement, value: string) {
            el.value = value;
            el.dispatchEvent(new Event('input'));
            await flush();
        }

        function quickCashButtons() {
            return [
                ...document.querySelectorAll<HTMLButtonElement>(
                    '[data-testid="quick-cash"] button',
                ),
            ];
        }

        it('offers Exact and the next likely amounts, none disabled', async () => {
            // ₱1,180: the product owner's example.
            mount(vi.fn(), { total: 118000, initialCash: null });
            await flush();

            expect(
                quickCashButtons().map((b) => b.textContent?.trim()),
            ).toEqual(['Exact', '₱1,200.00', '₱1,500.00', '₱2,000.00']);
            expect(quickCashButtons().some((b) => b.disabled)).toBe(false);
        });

        it('fills the amount from a quick-cash button and shows the change', async () => {
            const submit = vi.fn().mockResolvedValue(undefined);
            mount(submit, { initialCash: null });
            await flush();

            quickCashButtons()
                .find((b) => b.textContent?.trim() === '₱500.00')!
                .click();
            await flush();

            expect(amountInput().value).toBe('500.00');
            expect(document.body.textContent).toContain('Change Due:');
            expect(document.body.textContent).toContain('₱50.00');

            confirmButton().click();
            await flush();
            expect(submit).toHaveBeenCalledWith({
                paymentType: PaymentType.CASH,
                tenders: [{ type: 'CASH', amount: 50000 }],
            });
        });

        it('fills the exact total', async () => {
            mount(vi.fn(), { initialCash: null });
            await flush();
            quickCashButtons()[0].click();
            await flush();
            expect(amountInput().value).toBe('450.00');
            expect(confirmButton().disabled).toBe(false);
        });

        it('moves the focus to Confirm after Exact, so Enter confirms once (#197)', async () => {
            const submit = vi.fn(() => new Promise(() => {}));
            mount(submit, { initialCash: null });
            await flush();
            quickCashButtons()[0].click();
            await flush();
            expect(document.activeElement).toBe(confirmButton());
            // Confirm reads out the change along with the total.
            const described = confirmButton().getAttribute('aria-describedby');
            expect(document.getElementById(described!)?.textContent).toContain(
                'Change Due:',
            );

            // jsdom can't press Enter on the button, so this fires the
            // form's submit twice: still one sale.
            await pressEnter();
            await pressEnter();
            expect(submit).toHaveBeenCalledTimes(1);
        });

        it('moves the focus to Confirm after a quick amount too (#197)', async () => {
            mount(vi.fn(), { initialCash: null });
            await flush();
            quickCashButtons()
                .find((b) => b.textContent?.trim() === '₱500.00')!
                .click();
            await flush();
            expect(document.activeElement).toBe(confirmButton());
        });

        it('shows the GCash reference format error inline and holds Confirm', async () => {
            mount(vi.fn());
            await flush();
            methodButton('GCash').click();
            await flush();

            const reference = field('GCash reference number')!;
            // Nothing typed yet: no error, but nothing to confirm.
            expect(
                document.querySelector('[data-testid="reference-error"]'),
            ).toBeNull();
            expect(confirmButton().disabled).toBe(true);

            await typeInto(reference, '12345');
            const error = document.querySelector(
                '[data-testid="reference-error"]',
            )!;
            expect(error.textContent).toContain(
                'A GCash reference number is 13 digits',
            );
            expect(reference.getAttribute('aria-invalid')).toBe('true');
            expect(reference.getAttribute('aria-describedby')).toBe(error.id);
            expect(confirmButton().disabled).toBe(true);

            await typeInto(reference, '1234 567 890123');
            expect(
                document.querySelector('[data-testid="reference-error"]'),
            ).toBeNull();
            expect(confirmButton().disabled).toBe(false);
        });

        it('confirms a split whose cash covers the total, without a reference', async () => {
            const submit = vi.fn().mockResolvedValue(undefined);
            mount(submit, { initialMethod: PaymentType.SPLIT });
            await flush();

            await typeInto(field('Customer cash given')!, '500');

            // The reference is hidden, so it cannot be required.
            expect(field('GCash reference number')).toBeNull();
            expect(
                document.querySelector('[data-testid="split-covered"]'),
            ).not.toBeNull();
            expect(
                document.querySelector('[data-testid="split-change"]')
                    ?.textContent,
            ).toContain('₱50.00');
            expect(confirmButton().disabled).toBe(false);

            confirmButton().click();
            await flush();
            expect(submit).toHaveBeenCalledWith({
                paymentType: PaymentType.CASH,
                tenders: [{ type: 'CASH', amount: 50000 }],
            });
        });

        function splitBill(label: string) {
            return [
                ...document.querySelectorAll<HTMLButtonElement>('button'),
            ].find((b) => b.textContent?.trim() === label)!;
        }

        it('moves the focus to Confirm after a split bill that covers the total (#197)', async () => {
            mount(vi.fn(), { initialMethod: PaymentType.SPLIT });
            await flush();
            splitBill('₱500.00').click();
            await flush();
            expect(confirmButton().disabled).toBe(false);
            expect(document.activeElement).toBe(confirmButton());
            const described = confirmButton().getAttribute('aria-describedby');
            expect(document.getElementById(described!)?.textContent).toContain(
                '₱50.00',
            );
        });

        it('moves the focus to the reference after a split bill short of the total (#197)', async () => {
            mount(vi.fn(), { initialMethod: PaymentType.SPLIT });
            await flush();
            splitBill('₱100.00').click();
            await flush();
            expect(confirmButton().disabled).toBe(true);
            expect(document.activeElement).toBe(
                field('GCash reference number'),
            );
        });

        it('shows no change on a real split, and GCash the rest', async () => {
            const submit = vi.fn().mockResolvedValue(undefined);
            mount(submit, { initialMethod: PaymentType.SPLIT });
            await flush();

            await typeInto(field('Customer cash given')!, '300');
            expect(
                document.querySelector('[data-testid="split-gcash"]')
                    ?.textContent,
            ).toContain('₱150.00');
            expect(
                document.querySelector('[data-testid="split-change"]')
                    ?.textContent,
            ).toContain('₱0.00');
            expect(confirmButton().disabled).toBe(true);

            await typeInto(field('GCash reference number')!, '1234567890123');
            expect(confirmButton().disabled).toBe(false);
            confirmButton().click();
            await flush();
            expect(submit).toHaveBeenCalledWith({
                paymentType: PaymentType.SPLIT,
                tenders: [
                    { type: 'CASH', amount: 30000 },
                    { type: 'GCASH', amount: 15000 },
                ],
                referenceNumber: '1234567890123',
            });
        });
    });

    describe('method and quick-cash keys (#324)', () => {
        function radio(type: PaymentType) {
            return document.querySelector<HTMLButtonElement>(
                `[role="radio"][data-method="${type}"]`,
            )!;
        }

        function key(target: Element, k: string, init: KeyboardEventInit = {}) {
            const event = new KeyboardEvent('keydown', {
                key: k,
                bubbles: true,
                cancelable: true,
                ...init,
            });
            target.dispatchEvent(event);
            return event;
        }

        function splitInput() {
            return document.querySelector<HTMLInputElement>(
                'input[aria-label="Customer cash given"]',
            )!;
        }

        function pressed() {
            return [
                ...document.querySelectorAll('button[aria-pressed="true"]'),
            ].map((b) => b.textContent?.trim());
        }

        it('is a labelled radio group with one tab stop and shortcut hints', async () => {
            mount(vi.fn());
            await flush();
            const group = document.querySelector('[role="radiogroup"]')!;
            expect(group.getAttribute('aria-label')).toBe('Payment method');
            expect(radio(PaymentType.CASH).getAttribute('aria-checked')).toBe(
                'true',
            );
            expect(radio(PaymentType.CASH).tabIndex).toBe(0);
            expect(radio(PaymentType.GCASH).tabIndex).toBe(-1);
            expect(
                [PaymentType.CASH, PaymentType.GCASH, PaymentType.SPLIT].map(
                    (t) => radio(t).getAttribute('aria-keyshortcuts'),
                ),
            ).toEqual(['F1', 'F3', 'F6']);
            expect(
                radio(PaymentType.SPLIT).querySelector('[data-key-hint]')
                    ?.textContent,
            ).toBe('F6');
        });

        it('moves and selects with ←/→, without wrapping', async () => {
            mount(vi.fn());
            await flush();
            radio(PaymentType.CASH).focus();

            expect(
                key(radio(PaymentType.CASH), 'ArrowLeft').defaultPrevented,
            ).toBe(true);
            await flush();
            expect(document.activeElement).toBe(radio(PaymentType.CASH));

            key(radio(PaymentType.CASH), 'ArrowRight');
            await flush();
            expect(radio(PaymentType.GCASH).getAttribute('aria-checked')).toBe(
                'true',
            );
            expect(document.activeElement).toBe(radio(PaymentType.GCASH));
            expect(radio(PaymentType.GCASH).tabIndex).toBe(0);

            key(radio(PaymentType.GCASH), 'ArrowRight');
            await flush();
            key(radio(PaymentType.SPLIT), 'ArrowRight');
            await flush();
            expect(document.activeElement).toBe(radio(PaymentType.SPLIT));

            key(radio(PaymentType.SPLIT), 'ArrowLeft');
            await flush();
            expect(document.activeElement).toBe(radio(PaymentType.GCASH));
        });

        it('skips disabled methods when cash only', async () => {
            mount(vi.fn(), { cashOnly: true });
            await flush();
            radio(PaymentType.CASH).focus();
            key(radio(PaymentType.CASH), 'ArrowRight');
            await flush();
            expect(radio(PaymentType.CASH).getAttribute('aria-checked')).toBe(
                'true',
            );
            amountInput().focus();
            const event = key(amountInput(), 'F3');
            await flush();
            expect(event.defaultPrevented).toBe(true);
            expect(radio(PaymentType.CASH).getAttribute('aria-checked')).toBe(
                'true',
            );
        });

        it('switches with F1/F3/F6 from the amount field and focuses the field', async () => {
            mount(vi.fn());
            await flush();
            expect(document.activeElement).toBe(amountInput());

            const f3 = key(amountInput(), 'F3');
            await flush();
            expect(f3.defaultPrevented).toBe(true);
            expect(document.activeElement?.getAttribute('aria-label')).toBe(
                'GCash reference number',
            );

            const f6 = key(document.activeElement!, 'F6');
            await flush();
            expect(f6.defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(splitInput());

            const f1 = key(splitInput(), 'F1');
            await flush();
            expect(f1.defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(amountInput());
            expect(radio(PaymentType.CASH).getAttribute('aria-checked')).toBe(
                'true',
            );
        });

        it('leaves F5 and modified F-keys alone', async () => {
            mount(vi.fn());
            await flush();
            expect(key(amountInput(), 'F5').defaultPrevented).toBe(false);
            expect(
                key(amountInput(), 'F3', { shiftKey: true }).defaultPrevented,
            ).toBe(false);
        });

        it('steps Cash through Exact and the next rounds with ↓/↑, no wrap', async () => {
            mount(vi.fn(), { initialCash: null });
            await flush();
            const rounds = quickCashAmounts(TOTAL);
            const input = amountInput();

            expect(key(input, 'ArrowUp').defaultPrevented).toBe(true);
            await flush();
            expect(input.value).toBe('');

            key(input, 'ArrowDown');
            await flush();
            expect(input.value).toBe(centavosToPesoInput(TOTAL));
            expect(pressed()).toEqual(['Exact']);

            key(input, 'ArrowDown');
            await flush();
            expect(input.value).toBe(centavosToPesoInput(rounds[0]));
            expect(pressed()).toEqual([formatCurrency(rounds[0])]);

            for (let i = 0; i < rounds.length + 2; i++) {
                key(input, 'ArrowDown');
                await flush();
            }
            expect(input.value).toBe(
                centavosToPesoInput(rounds[rounds.length - 1]),
            );

            for (let i = 0; i < rounds.length + 2; i++) {
                key(input, 'ArrowUp');
                await flush();
            }
            expect(input.value).toBe(centavosToPesoInput(TOTAL));
            expect(document.activeElement).toBe(input);
        });

        it('steps from a typed amount to the next quick amount above it', async () => {
            mount(vi.fn(), { initialCash: null });
            await flush();
            const input = amountInput();
            input.value = '470';
            input.dispatchEvent(new Event('input'));
            await flush();
            expect(pressed()).toEqual([]);
            key(input, 'ArrowDown');
            await flush();
            const above = quickCashAmounts(TOTAL).find((a) => a > 47000)!;
            expect(input.value).toBe(centavosToPesoInput(above));
        });

        it('completes with the exact amount on ↓ then Enter', async () => {
            const submit = vi.fn().mockResolvedValue(undefined);
            mount(submit, { initialCash: null });
            await flush();
            key(amountInput(), 'ArrowDown');
            await flush();
            await pressEnter();
            expect(submit).toHaveBeenCalledWith({
                paymentType: PaymentType.CASH,
                tenders: [{ type: 'CASH', amount: TOTAL }],
            });
        });

        it('steps the Split cash field through the split bills', async () => {
            mount(vi.fn(), { initialMethod: PaymentType.SPLIT });
            await flush();
            const input = splitInput();
            key(input, 'ArrowDown');
            await flush();
            expect(input.value).toBe('5.00');
            expect(pressed()).toEqual(['₱5.00']);
            key(input, 'ArrowDown');
            await flush();
            expect(input.value).toBe('10.00');
            key(input, 'ArrowUp');
            await flush();
            expect(input.value).toBe('5.00');
        });

        it('leaves ↑/↓ alone in the GCash reference', async () => {
            mount(vi.fn(), { initialMethod: PaymentType.GCASH });
            await flush();
            const ref = document.querySelector<HTMLInputElement>(
                'input[aria-label="GCash reference number"]',
            )!;
            expect(key(ref, 'ArrowDown').defaultPrevented).toBe(false);
        });
    });
});
