import {
    DISCOUNT_LIMITS,
    discountAmount,
    type DiscountInput,
    isValidReferenceNumber,
    normalizeReferenceNumber,
    NUMERIC_LIMITS,
    PaymentType,
    REFERENCE_NUMBER_LIMITS,
    TenderType,
} from '@grocery-pos/contracts';
import { pesosToCentavos } from '@/utils/currency';
import type { PaymentRequest } from './types';

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
 * Why a typed GCash reference would be rejected by the API, or null if it is
 * fine. Spaces are ignored, as on the server.
 */
export function referenceNumberError(input: string): string | null {
    const digits = normalizeReferenceNumber(input);
    if (!digits) return 'Enter the GCash reference number';
    if (isValidReferenceNumber(digits)) return null;
    return `A GCash reference number is ${REFERENCE_NUMBER_LIMITS.MIN_LENGTH} digits`;
}

/** What the cashier typed into the checkout modal. */
export interface TenderInput {
    /** Typed pesos: cash handed over (CASH, and the cash part of SPLIT). */
    cash: string | number;
    /** Typed GCash reference (GCASH and SPLIT). */
    referenceNumber: string;
}

/**
 * Builds the payment part of `POST /sales` from the checkout form, or null
 * when the form cannot be confirmed yet. Mirrors the server's checks
 * against the previewed total (centavos); the server re-checks against the
 * total it charges.
 *
 * SPLIT is the cash given plus GCash for the rest. If the cash alone covers
 * the total there is nothing left for GCash, so it is sent as a CASH sale.
 */
export function buildPayment(
    method: PaymentType,
    total: number,
    input: TenderInput,
): PaymentRequest | null {
    const cash = pesosToCentavos(input.cash);
    const referenceNumber = normalizeReferenceNumber(input.referenceNumber);
    const hasReference = isValidReferenceNumber(referenceNumber);

    if (
        method === PaymentType.CASH ||
        (method === PaymentType.SPLIT && cash >= total)
    ) {
        if (cash < total) return null;
        return {
            paymentType: PaymentType.CASH,
            tenders: [{ type: TenderType.CASH, amount: cash }],
        };
    }

    if (!hasReference) return null;

    if (method === PaymentType.GCASH) {
        return {
            paymentType: PaymentType.GCASH,
            tenders: [{ type: TenderType.GCASH, amount: total }],
            referenceNumber,
        };
    }

    if (cash <= 0) return null;
    return {
        paymentType: PaymentType.SPLIT,
        tenders: [
            { type: TenderType.CASH, amount: cash },
            { type: TenderType.GCASH, amount: total - cash },
        ],
        referenceNumber,
    };
}

const PAYMENT_LABELS: Record<PaymentType, string> = {
    [PaymentType.CASH]: 'Cash',
    [PaymentType.GCASH]: 'GCash (QR)',
    [PaymentType.SPLIT]: 'Split (Cash + GCash)',
};

export function paymentLabel(type: PaymentType): string {
    return PAYMENT_LABELS[type] ?? type;
}

export function tenderLabel(type: TenderType): string {
    return type === TenderType.CASH ? 'Cash Tendered' : 'GCash Paid';
}
