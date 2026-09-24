import { percentOf, pesosToCentavos } from '@/utils/currency';

/** The amount due after an order discount, in centavos. */
export function discountedTotal(
    subtotal: number,
    discountPercent: number,
): number {
    return subtotal - percentOf(subtotal, discountPercent);
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
