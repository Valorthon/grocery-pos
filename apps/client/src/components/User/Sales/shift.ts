import {
    type BillCounts,
    CASH_DENOMINATIONS,
    type CashDenomination,
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
