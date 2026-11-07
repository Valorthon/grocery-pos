import {
    type BillCounts,
    billCountTotal,
    CASH_DENOMINATIONS,
    type CashDenomination,
    ErrorCode,
    NUMERIC_LIMITS,
    type OfflinePendingDetails,
    SHIFT_LIMITS,
} from '@grocery-pos/contracts';
import { apiErrorBody, apiErrorText } from '@/utils/api-error';

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

/** Why a count over `NUMERIC_LIMITS.AMOUNT_MAX` is not submitted. */
export const COUNTED_TOO_MUCH =
    'The counted cash is more than any drawer can hold.';

/**
 * Why a whole drawer count is not submitted, or '' when it may be: a
 * field `BillCountInput` flagged (`invalid`), or a total over AMOUNT_MAX,
 * which the API's `countedTotal` refuses too.
 */
export function countsError(counts: BillCounts, invalid: boolean): string {
    if (invalid) return COUNTS_INVALID;
    if (billCountTotal(counts) > NUMERIC_LIMITS.AMOUNT_MAX) {
        return COUNTED_TOO_MUCH;
    }
    return '';
}

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

/**
 * How many terminals still block the cashier's close (#143): the
 * `details.terminals` of an OFFLINE_PENDING refusal, or null when the
 * error is something else or the count is missing or malformed.
 */
export function blockingTerminals(error: unknown): number | null {
    const body = apiErrorBody(error);
    if (body?.error !== ErrorCode.OFFLINE_PENDING) return null;
    const details = body.details as Partial<OfflinePendingDetails> | null;
    const terminals = details?.terminals;
    return typeof terminals === 'number' &&
        Number.isInteger(terminals) &&
        terminals > 0
        ? terminals
        : null;
}

/** Why the server refused the close because terminals are still offline. */
export function offlinePendingText(terminals: number): string {
    const who =
        terminals === 1
            ? '1 terminal still has'
            : `${terminals.toLocaleString('en-PH')} terminals still have`;
    return `${who} offline sales or leases open for this shift. Sync their pending cash sales and turn offline mode off there, then close. If a terminal's browser data is gone, ask an admin to force-close the shift.`;
}

/**
 * What Shift Out shows for a failed close: the blocking-terminal count
 * when the server sent one, else the usual API error text.
 */
export function closeErrorText(error: unknown, fallback: string): string {
    const terminals = blockingTerminals(error);
    return terminals === null
        ? apiErrorText(error, fallback)
        : offlinePendingText(terminals);
}
