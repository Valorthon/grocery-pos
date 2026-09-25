import { PaymentType } from './enums';
import { TenderType } from './sales';
import { NUMERIC_LIMITS } from './limits';

/**
 * Server-side cash shifts (issue #2). A cashier opens a shift with a counted
 * float, rings sales into it, records cash in / cash drops, and closes it
 * with a blind count; the server works out the expected cash and persists
 * the Z-read on the shift. All money is integer centavos.
 */
export enum ShiftStatus {
    OPEN = 'OPEN',
    CLOSED = 'CLOSED',
}

/** A recorded change to the drawer's cash other than a sale. */
export enum DrawerMovementType {
    /** Cash added to the drawer (change, float top-up). */
    CASH_IN = 'CASH_IN',
    /** Cash taken out to the safe. Never checked against expected cash. */
    CASH_DROP = 'CASH_DROP',
    /**
     * Cash handed back for a voided or refunded sale, recorded by the ADMIN's
     * reversal on the shift that paid it out.
     */
    REVERSAL_PAYOUT = 'REVERSAL_PAYOUT',
}

/** The movements a cashier records themselves (`POST /shifts/current/drawer`). */
export const CASHIER_DRAWER_MOVEMENTS = [
    DrawerMovementType.CASH_IN,
    DrawerMovementType.CASH_DROP,
] as const;

export type CashierDrawerMovement = (typeof CASHIER_DRAWER_MOVEMENTS)[number];

/**
 * Shown on the register and recorded on each shift until terminals get an
 * identity of their own (#47). Only a label.
 */
export const DEFAULT_TERMINAL = 'Lane #1';

export interface CashDenomination {
    /** Key used in bill counts. */
    id: string;
    /** Centavos. */
    value: number;
    label: string;
    kind: 'bill' | 'coin';
}

/**
 * Philippine bills and coins the drawer is counted in. The client's count
 * form and the server's float and closing totals both use this list, so a
 * count means the same amount on both sides.
 */
export const CASH_DENOMINATIONS: readonly CashDenomination[] = [
    { id: '1000', value: 100_000, label: '₱1,000', kind: 'bill' },
    { id: '500', value: 50_000, label: '₱500', kind: 'bill' },
    { id: '200', value: 20_000, label: '₱200', kind: 'bill' },
    { id: '100', value: 10_000, label: '₱100', kind: 'bill' },
    { id: '50', value: 5_000, label: '₱50', kind: 'bill' },
    { id: '20', value: 2_000, label: '₱20', kind: 'bill' },
    { id: 'coin-20', value: 2_000, label: '₱20', kind: 'coin' },
    { id: 'coin-10', value: 1_000, label: '₱10', kind: 'coin' },
    { id: 'coin-5', value: 500, label: '₱5', kind: 'coin' },
    { id: 'coin-1', value: 100, label: '₱1', kind: 'coin' },
    { id: 'coin-0.25', value: 25, label: '₱0.25', kind: 'coin' },
];

/** Pieces of one denomination, keyed by `CashDenomination.id`. */
export type BillCounts = Record<string, number>;

export const SHIFT_LIMITS = {
    /** Most pieces of a single denomination one count may hold. */
    PIECES_MAX: 100_000,
    /** Smallest opening float, in centavos: a shift opens with cash. */
    OPENING_FLOAT_MIN: NUMERIC_LIMITS.AMOUNT_MIN,
} as const;

const DENOMINATION_VALUES = new Map(
    CASH_DENOMINATIONS.map((d) => [d.id, d.value]),
);

/** Whether `id` is a denomination in `CASH_DENOMINATIONS`. */
export function isDenomination(id: string): boolean {
    return DENOMINATION_VALUES.has(id);
}

/**
 * The cash a count adds up to, in centavos. Unknown keys and non-positive
 * or fractional counts contribute nothing; the API refuses them before
 * counting.
 */
export function billCountTotal(counts: BillCounts): number {
    let total = 0;
    for (const [id, pieces] of Object.entries(counts)) {
        const value = DENOMINATION_VALUES.get(id);
        if (value === undefined || !Number.isInteger(pieces) || pieces <= 0) {
            continue;
        }
        total += value * pieces;
    }
    return total;
}

/**
 * Cash a sale left in the drawer, in centavos: its cash tender less the
 * change given (for SPLIT, the cash part less change). Zero for GCash.
 * A sale stored before tenders existed is all cash when its payment type
 * is CASH. This is also what a void or refund pays back out of a drawer.
 */
export function saleNetCash(sale: {
    paymentType: PaymentType;
    amount: number;
    tenders?: { type: TenderType; amount: number }[] | null;
    changeGiven?: number | null;
}): number {
    if (!sale.tenders || sale.tenders.length === 0) {
        return sale.paymentType === PaymentType.CASH ? sale.amount : 0;
    }
    const cash = sale.tenders
        .filter((t) => t.type === TenderType.CASH)
        .reduce((sum, t) => sum + t.amount, 0);
    return cash > 0 ? cash - (sale.changeGiven ?? 0) : 0;
}

/** One drawer movement as the API returns it. */
export interface DrawerMovementView {
    type: DrawerMovementType;
    /** Centavos, always positive; the type says which way it went. */
    amount: number;
    reason: string;
    /** ISO timestamp. */
    at: string;
    /** Username of who recorded it. */
    byName: string;
    /** For REVERSAL_PAYOUT: the reversed sale's id. */
    sale: string | null;
}

/**
 * The cashier's own open shift, as `GET /shifts/current` returns it. Blind
 * on purpose: no expected cash, no cash-sales total, no variance, and no
 * payouts an ADMIN charged to it. Those appear only in the Z-read, after
 * the count is submitted.
 */
export interface CurrentShiftView {
    _id: string;
    status: ShiftStatus;
    cashierName: string;
    terminal: string;
    /** ISO timestamp. */
    openedAt: string;
    /** Centavos: what the cashier counted in at open. */
    openingFloat: number;
    /** The cashier's own cash in and cash drops, oldest first. */
    movements: DrawerMovementView[];
}

/** A count of sales and the centavos they add up to. */
export interface CountedAmount {
    count: number;
    amount: number;
}

/**
 * The shift close report (Z-read), computed by the server when the shift
 * closes and stored on it. Every figure is centavos. It reconciles:
 *
 *   sales.gross = tenders.cash + tenders.gcash
 *   sales.net   = sales.gross - voids.amount - refunds.amount
 *   expectedCash = openingFloat + cashIn - cashDrops + tenders.cash
 *                  - reversalPayouts.amount
 *   overShort   = countedCash - expectedCash
 */
export interface ZReadReport {
    shiftId: string;
    cashierName: string;
    terminal: string;
    /** ISO timestamps. */
    openedAt: string;
    closedAt: string;
    /** Username of whoever submitted the count. */
    closedByName: string;
    /** True when an ADMIN closed someone else's shift. */
    closedByAdmin: boolean;
    sales: {
        /** Every sale rung in the shift, reversed or not. */
        count: number;
        /** Their charged totals (after discounts). */
        gross: number;
        /** Discounts given on those sales. */
        discounts: CountedAmount;
        /** Sales of this shift voided / refunded before it closed. */
        voids: CountedAmount;
        refunds: CountedAmount;
        /** `gross - voids - refunds`. */
        net: number;
    };
    tenders: {
        /** Cash kept from sales: cash tendered less change. */
        cash: number;
        gcash: number;
    };
    drawer: {
        openingFloat: number;
        cashIn: number;
        cashDrops: number;
        /** Cash paid out of this drawer for voids and refunds. */
        reversalPayouts: CountedAmount;
        expectedCash: number;
        countedCash: number;
        /** Positive: over. Negative: short. */
        overShort: number;
    };
    /** Every drawer movement of the shift, oldest first. */
    movements: DrawerMovementView[];
}

/** A row of the ADMIN's shift list (`GET /shifts`). */
export interface ShiftListItem {
    _id: string;
    status: ShiftStatus;
    cashierName: string;
    terminal: string;
    openedAt: string;
    closedAt: string | null;
    openingFloat: number;
    /** Null while open. */
    report: ZReadReport | null;
}
