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

const PESO_INPUT = /^(-?)(\d*)(?:\.(\d{0,2}))?$/;

/**
 * Parses a typed peso amount into centavos from its decimal digits, never by
 * multiplying a double (1.005 * 100 is 100.49999999999999). Returns null for
 * blank input and for anything that is not a plain amount with at most two
 * decimals ("abc", "1.005", "1e3", "-"), so a form can tell "left blank" and
 * "mistyped" apart from a real ₱0.00.
 */
export function parsePesos(
    pesos: string | number | null | undefined,
): number | null {
    const match = PESO_INPUT.exec(String(pesos ?? '').trim());
    if (!match) return null;

    const [, sign, whole = '', fraction = ''] = match;
    if (!whole && !fraction) return null;

    const centavos =
        Number(whole || '0') * CENTAVOS_PER_PESO +
        Number(fraction.padEnd(2, '0'));
    return sign && centavos ? -centavos : centavos;
}

/**
 * Converts a typed peso amount to centavos (see `parsePesos`). Blank or
 * invalid input, including more than two decimals, is 0 so callers treat it
 * as empty; forms that must reject it validate with `moneyError` first.
 */
export function pesosToCentavos(
    pesos: string | number | null | undefined,
): number {
    return parsePesos(pesos) ?? 0;
}

/** Converts centavos to pesos for pre-filling a number input. */
export function centavosToPesos(centavos: number): number {
    return centavos / CENTAVOS_PER_PESO;
}

/** Pre-fills a text-bound money input with exactly two decimals. */
export function centavosToPesoInput(centavos: number): string {
    return centavosToPesos(centavos).toFixed(2);
}
