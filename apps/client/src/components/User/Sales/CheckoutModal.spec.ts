import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, nextTick, ref } from 'vue';
import { PaymentType } from '@grocery-pos/contracts';
import CheckoutModal from './CheckoutModal.vue';
import type { PaymentRequest } from './types';

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
            const gcash = [...document.querySelectorAll('button')].find(
                (b) => b.textContent?.trim() === 'GCash',
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
            expect(document.activeElement).toBe(amountInput());
        });
    });
    describe('tendering (#23)', () => {
        function methodButton(name: string) {
            return [...document.querySelectorAll('button')].find(
                (b) => b.textContent?.trim() === name,
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
});
