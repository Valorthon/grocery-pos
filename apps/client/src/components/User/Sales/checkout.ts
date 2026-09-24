import {
    DISCOUNT_LIMITS,
    discountAmount,
    type DiscountInput,
    NUMERIC_LIMITS,
} from '@grocery-pos/contracts';
import { pesosToCentavos } from '@/utils/currency';
import type { PaymentInfo, Receipt } from './types';

/**
 * The checkout preview of a discounted sale, in centavos, for tendering.
 *
 * It uses the same `discountAmount` the API charges with, so the preview and
 * the server agree; the server's response is still what the receipt and the
 * drawer record.
 */
export function previewSale(
    subtotal: number,
    discount: Pick<DiscountInput, 'type' | 'value'> | null,
) {
    const amount = discount ? discountAmount(subtotal, discount) : 0;
    const total = subtotal - amount;
    return {
        subtotal,
        discountAmount: amount,
        total,
        /**
         * Mirrors the server's 400s: a discount that rounds to nothing, or
         * one that leaves an over-discounted or ₱0 sale.
         */
        isChargeable:
            (discount === null || amount >= DISCOUNT_LIMITS.AMOUNT_MIN) &&
            total >= NUMERIC_LIMITS.AMOUNT_MIN,
    };
}

/** Checks typed cash (pesos) against a total due (centavos). */
export function cashTender(total: number, tenderedInput: string | number) {
    const tendered = pesosToCentavos(tenderedInput);
    return {
        tendered,
        changeDue: Math.max(0, tendered - total),
        isSufficient: tendered >= total,
    };
}

/**
 * Cash that stays in the drawer for a completed sale, from the total the
 * server charged rather than the client's preview.
 */
export function drawerCashAmount(
    payment: PaymentInfo,
    receipt: Pick<Receipt, 'totalAmount'>,
): number {
    if (payment.method === 'CASH') return receipt.totalAmount;
    if (payment.method === 'SPLIT') {
        return Math.min(receipt.totalAmount, payment.split?.cashTendered ?? 0);
    }
    return 0;
}
