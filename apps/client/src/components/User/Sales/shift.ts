import {
    type BillCounts,
    CASH_DENOMINATIONS,
    type CashDenomination,
    SHIFT_LIMITS,
} from '@grocery-pos/contracts';

export type { BillCounts };

/**
 * The denominations the drawer is counted in, from contracts, so a count
 * adds up to the same centavos here and on the server (which recomputes
 * every total from the counts the client sends).
 */
export const PAPER_DENOMINATIONS: readonly CashDenomination[] =
    CASH_DENOMINATIONS.filter((d) => d.kind === 'bill');

export const COIN_DENOMINATIONS: readonly CashDenomination[] =
    CASH_DENOMINATIONS.filter((d) => d.kind === 'coin');

/** Total pieces in a count. */
export function countPieces(counts: BillCounts): number {
    return Object.values(counts).reduce(
        (sum: number, c: number) => sum + (c || 0),
        0,
    );
}

/** Why Shift In refuses a ₱0 count: a shift opens with cash (#2). */
export const FLOAT_REQUIRED =
    'Count the opening float. It must be more than ₱0.';

/** Why a count with a refused field is not submitted. */
export const COUNTS_INVALID = 'Fix the highlighted counts first.';

const WHOLE_NUMBER = /^\d+$/;

/**
 * Why a typed piece count is refused, or '' when it is accepted (blank
 * means none). Mirrors the API's `IsBillCounts`: a whole number from 0 to
 * `SHIFT_LIMITS.PIECES_MAX`, so "2.5" is refused rather than cut to 2.
 */
export function piecesError(text: string): string {
    const value = text.trim();
    if (!value) return '';
    if (WHOLE_NUMBER.test(value)) {
        return Number(value) > SHIFT_LIMITS.PIECES_MAX
            ? `At most ${SHIFT_LIMITS.PIECES_MAX.toLocaleString('en-PH')} pcs`
            : '';
    }
    if (/^-\s*\d/.test(value)) return 'Can’t be negative';
    return 'Whole pieces only';
}
