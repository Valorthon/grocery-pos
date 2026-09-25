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

/** Enter in a field: the browser submits the form (jsdom does not). */
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
    });
});
