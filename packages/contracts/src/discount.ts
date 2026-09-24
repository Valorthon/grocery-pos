/**
 * Sale-level discount, shared so the client's checkout preview and the API's
 * charged total use the same arithmetic. All money is integer centavos.
 */
export enum DiscountType {
    /** `value` is a whole percent of the subtotal, 1-100. */
    PERCENT = 'PERCENT',
    /** `value` is an amount in centavos. */
    FIXED = 'FIXED',
}

export const DISCOUNT_LIMITS = {
    PERCENT_MIN: 1,
    PERCENT_MAX: 100,
    /** Smallest fixed discount, in centavos. */
    FIXED_MIN: 1,
} as const;

/** What the client sends in `POST /sales` to discount the whole sale. */
export interface DiscountInput {
    type: DiscountType;
    value: number;
    reason: string;
}

/**
 * The discount in centavos for a subtotal in centavos.
 *
 * A percent is rounded half-up to the nearest centavo, in integer arithmetic
 * (subtotal and percent are both integers, so nothing is lost to doubles). A
 * fixed amount is returned as-is; callers decide whether it exceeds the
 * subtotal, since the server rejects that rather than clamping it.
 */
export function discountAmount(
    subtotal: number,
    discount: Pick<DiscountInput, 'type' | 'value'>,
): number {
    if (discount.type === DiscountType.PERCENT) {
        return Math.floor((subtotal * discount.value + 50) / 100);
    }
    return discount.value;
}
