import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, nextTick, ref } from 'vue';
import {
    DEFAULT_TERMINAL,
    DiscountType,
    PaymentType,
    SaleStatus,
    TenderType,
} from '@grocery-pos/contracts';
import ReceiptModal from './ReceiptModal.vue';
import type { Receipt } from './types';

const RECEIPT: Receipt = {
    _id: '66f3a1b2c3d4e5f601234567',
    createdAt: '2026-09-25T00:05:00.000Z', // 8:05 AM in Manila
    status: SaleStatus.COMPLETED,
    paymentType: PaymentType.CASH,
    referenceNumber: null,
    tenders: [{ type: TenderType.CASH, amount: 10_000 }],
    amountTendered: 10_000,
    changeGiven: 500,
    cashierName: 'ana',
    items: [{ productName: 'milk', quantity: 1, amount: 9_500 }],
    subtotal: 9_500,
    discount: null,
    totalAmount: 9_500,
};

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
});

async function flush() {
    for (let i = 0; i < 5; i++) await nextTick();
}

/** Mounts an open receipt; returns the ref that swaps in the next sale. */
async function mount(receipt: Receipt) {
    const current = ref<Receipt>(receipt);
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () =>
            h(ReceiptModal, { modelValue: true, receipt: current.value }),
    });
    app.mount(host);
    await flush();
    return current;
}

function byTestId(id: string) {
    return document.querySelector(`[data-testid="${id}"]`);
}

/** ICU may put U+202F or U+00A0 before AM/PM; compare with plain spaces. */
function plain(text: string | null | undefined) {
    return (text ?? '').replace(/\s+/g, ' ');
}

function dialogText() {
    return document.querySelector('[role="dialog"]')?.textContent ?? '';
}

describe('ReceiptModal (issue #24)', () => {
    it("shows each sale's own server time in the store timezone", async () => {
        // The device clock is nowhere near either sale.
        vi.useFakeTimers({ now: new Date('2030-01-01T12:00:00Z') });
        const current = await mount(RECEIPT);
        expect(plain(byTestId('receipt-date')?.textContent)).toBe(
            'Sep 25, 2026, 8:05 AM',
        );
        expect(byTestId('receipt-date')?.getAttribute('datetime')).toBe(
            RECEIPT.createdAt,
        );

        current.value = {
            ...RECEIPT,
            _id: '66f3a1b2c3d4e5f601234568',
            createdAt: '2026-09-25T13:47:00.000Z', // 9:47 PM in Manila
        };
        await flush();
        expect(plain(byTestId('receipt-date')?.textContent)).toBe(
            'Sep 25, 2026, 9:47 PM',
        );
    });

    it('shows the sale number and the full id', async () => {
        await mount(RECEIPT);
        expect(byTestId('receipt-sale-number')?.textContent).toBe(
            'Sale #01234567',
        );
        expect(byTestId('receipt-sale-id')?.textContent).toContain(RECEIPT._id);
    });

    it('shows ₱0.00 change on exact cash', async () => {
        await mount({ ...RECEIPT, amountTendered: 9_500, changeGiven: 0 });
        expect(byTestId('receipt-change')?.textContent).toContain('₱0.00');
    });

    it('has no Change line on a GCash-only sale', async () => {
        await mount({
            ...RECEIPT,
            paymentType: PaymentType.GCASH,
            referenceNumber: '1234567890123',
            tenders: [{ type: TenderType.GCASH, amount: 9_500 }],
            amountTendered: 9_500,
            changeGiven: 0,
        });
        expect(byTestId('receipt-change')).toBeNull();
    });

    it('labels the discount "Discount" with the server amount and total', async () => {
        await mount({
            ...RECEIPT,
            subtotal: 10_000,
            discount: {
                type: DiscountType.PERCENT,
                value: 10,
                reason: 'loyal customer',
                amount: 1_000,
            },
            totalAmount: 9_000,
        });
        const text = dialogText();
        expect(text).toContain('Discount (10%):');
        expect(text).toContain('-₱10.00');
        expect(text).toContain('₱90.00');
        expect(text).not.toMatch(/Savings|Order Discount/);
    });

    it('has no sales tax line and no Print button', async () => {
        await mount(RECEIPT);
        expect(dialogText()).not.toMatch(/tax/i);
        const buttons = [...document.querySelectorAll('button')].map((b) =>
            b.textContent?.trim(),
        );
        expect(buttons).not.toContain('Print');
        expect(buttons).toContain('Next Sale');
    });

    it('shows no made-up store details, but the terminal and cashier', async () => {
        await mount(RECEIPT);
        const text = dialogText();
        expect(text).not.toContain('Store #');
        expect(text).not.toContain('(415)');
        expect(text).not.toMatch(/return policy/i);
        expect(byTestId('receipt-terminal')?.textContent).toBe(
            DEFAULT_TERMINAL,
        );
        expect(text).toContain('Cashier: ana');
    });
});
