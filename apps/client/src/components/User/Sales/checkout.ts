import {
    DISCOUNT_LIMITS,
    discountAmount,
    type DiscountInput,
    isValidReferenceNumber,
    normalizeReferenceNumber,
    NUMERIC_LIMITS,
    type PaymentRequest,
    PaymentType,
    REFERENCE_NUMBER_LIMITS,
    TenderType,
} from '@grocery-pos/contracts';
import { formatCurrency, parsePesos, pesosToCentavos } from '@/utils/currency';
import { moneyError } from '@/utils/rules';

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

/**
 * Why a typed fixed discount (pesos) would be refused, or '' when it is
 * fine, against the ticket's subtotal (centavos). Mirrors the API: a
 * whole-centavo amount from ₱0.01 up to AMOUNT_MAX (the DTO), no more than
 * the subtotal ("Discount exceeds the sale subtotal") and leaving
 * something to charge ("Discount leaves nothing to charge").
 */
export function fixedDiscountError(input: string, subtotal: number): string {
    const error = moneyError(input, DISCOUNT_LIMITS.FIXED_MIN);
    if (error) return error;
    const amount = parsePesos(input) ?? 0;
    if (amount > subtotal) {
        return `Can't be more than the subtotal (${formatCurrency(subtotal)})`;
    }
    if (subtotal - amount < NUMERIC_LIMITS.AMOUNT_MIN) {
        return 'Must leave something to charge';
    }
    return '';
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

/** The note steps quick cash rounds up to, in centavos (₱20 … ₱1,000). */
export const QUICK_CASH_STEPS = [20, 50, 100, 500, 1000].map((p) => p * 100);
/** Most quick-cash amounts offered besides Exact. */
export const QUICK_CASH_MAX = 4;

/**
 * The amounts a customer is likely to hand over for `total` (centavos),
 * besides the exact amount (decision 2026-09-25, #23): the total rounded
 * up to the next ₱1,000, ₱500, ₱100, ₱50 and ₱20 (what real notes add up
 * to), strictly above the total, without duplicates, at most
 * QUICK_CASH_MAX, smallest first. When there are more, the larger notes
 * win: for ₱35 a ₱1,000 note is likelier than exactly ₱40. E.g. ₱1,180
 * gives ₱1,200, ₱1,500 and ₱2,000.
 */
export function quickCashAmounts(total: number): number[] {
    if (!Number.isSafeInteger(total) || total <= 0) return [];
    const amounts = new Set<number>();
    for (const step of [...QUICK_CASH_STEPS].reverse()) {
        if (amounts.size === QUICK_CASH_MAX) break;
        const next = (Math.floor(total / step) + 1) * step;
        if (next <= NUMERIC_LIMITS.AMOUNT_MAX) amounts.add(next);
    }
    return [...amounts].sort((a, b) => a - b);
}

/**
 * Split tendering as the checkout sends it (see `buildPayment`), in
 * centavos: GCash pays whatever the cash does not, so change only arises
 * when the cash alone covers the total, and that is sent as a CASH sale.
 * The server (`settleTenders`) likewise pays change out of the cash only.
 */
export function splitTender(total: number, cashInput: string | number) {
    const cash = pesosToCentavos(cashInput);
    const gcash = Math.max(0, total - cash);
    return {
        cash,
        gcash,
        changeDue: Math.max(0, cash - total),
        /** True when the cash alone pays: recorded as a cash sale. */
        coversTotal: cash >= total,
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
