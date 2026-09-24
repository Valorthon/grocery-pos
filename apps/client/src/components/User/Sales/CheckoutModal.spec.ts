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
function mount(submit: (payment: PaymentRequest) => Promise<unknown>) {
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
});
