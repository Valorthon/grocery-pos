/**
 * Money is integer centavos everywhere (API, stores, localStorage, props).
 * Pesos exist only where a user types an amount or reads one on screen, and
 * these helpers are the only place that converts between the two.
 */
export const CENTAVOS_PER_PESO = 100;

/** Formats centavos as pesos, e.g. -500 -> "-₱5.00". */
export function formatCurrency(centavos: number): string {
    const pesos = Math.abs(centavos) / CENTAVOS_PER_PESO;
    const sign = Math.round(centavos) < 0 ? '-' : '';
    return `${sign}₱${pesos.toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

/** Converts a typed peso amount to centavos; blank or invalid input is 0. */
export function pesosToCentavos(pesos: string | number | null | undefined) {
    const value = typeof pesos === 'number' ? pesos : parseFloat(pesos ?? '');
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * CENTAVOS_PER_PESO);
}

/** Converts centavos to pesos for pre-filling a number input. */
export function centavosToPesos(centavos: number): number {
    return centavos / CENTAVOS_PER_PESO;
}

/** Pre-fills a text-bound money input with exactly two decimals. */
export function centavosToPesoInput(centavos: number): string {
    return centavosToPesos(centavos).toFixed(2);
}

/** A percentage of an amount, rounded to the nearest centavo. */
export function percentOf(centavos: number, percent: number): number {
    return Math.round((centavos * percent) / 100);
}
