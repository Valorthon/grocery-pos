import { StockMovementType } from '@grocery-pos/contracts';
import type { StatusMap } from '@/components/ui/status-badge';
import { enumHelp, statusHelp } from '@/components/ui/column-help';
import type { ColumnHelp } from '@/components/ui/types';

/** Column help for a product's stock history (#263). */
export const STOCK_HISTORY_HELP = {
    occurred:
        'When it happened. Posted is when the system recorded it; they differ for offline sales that sync later. Date filters use Posted.',
    type: [
        ...enumHelp<StockMovementType>({
            [StockMovementType.SALE]: 'Sold.',
            [StockMovementType.RESTOCK]: 'Received from a supplier.',
            [StockMovementType.ADJUSTMENT]: 'Manual stock adjustment.',
            [StockMovementType.VOID]: 'Put back by a voided sale.',
            [StockMovementType.REFUND]: 'Put back by a refunded sale.',
            [StockMovementType.COUNT]: 'Approved stock count difference.',
            [StockMovementType.OPENING]: 'Unattributed starting balance.',
        }),
        {
            term: '(derived history)',
            meaning:
                'Rebuilt from older records, not a verified historical count.',
        },
    ],
    change: 'Quantity moved: + in, − out.',
    balance: 'Stock after this movement, in posting order.',
    source: 'The record that caused the movement.',
} satisfies Record<string, ColumnHelp>;

/** A batch's expiry state (#42, #247). */
export type BatchStatus =
    'expired' | 'soon' | 'ok' | 'check' | 'reconciliation';
export const BATCH_STATUS: StatusMap<BatchStatus> = {
    expired: { label: 'Expired', color: 'error' },
    soon: { label: 'Expiring soon', color: 'warning' },
    ok: { label: 'OK', color: 'success' },
    check: { label: 'Check expiry', color: 'warning' },
    reconciliation: { label: 'Reconciliation', color: 'neutral' },
};

/** Column help for the batch list (#263). */
export const BATCH_HELP = {
    batch: 'Batch number, else the last 8 characters of its id.',
    expiry: statusHelp(BATCH_STATUS, {
        expired: "Past its expiry day; can't be sold.",
        soon: "Expires within the store's alert days (Settings).",
        ok: 'Expires later than the alert days.',
        check: 'Dated, but its days left are unknown; check the date.',
        reconciliation:
            "Undated lot (offline cash reconciliation or a legacy return); can't be sold, needs review.",
    }),
    daysLeft:
        'Store-calendar days to the expiry date; a lot is usable through its expiry day.',
} satisfies Record<string, ColumnHelp>;

/** The #40 / dashboard predicate: out at ≤ 0, low at ≤ the reorder level. */
export type StockStatus = 'out' | 'low' | 'ok';
export const STOCK_STATUS: StatusMap<StockStatus> = {
    out: { label: 'Out of stock', color: 'error' },
    low: { label: 'Low stock', color: 'warning' },
    ok: { label: 'In stock', color: 'success' },
};
const stockStatusHelp = statusHelp(STOCK_STATUS, {
    out: 'Stock is 0 or less.',
    low: 'Stock is above 0 and at or below its Low stock at level.',
    ok: 'Stock is above its Low stock at level.',
});

/** Column help for the inventory list (#263). */
export const INVENTORY_HELP = {
    // Below sm the status badge sits under the stock, so Stock carries
    // the status meanings too.
    stock: [
        {
            term: 'Stock',
            meaning: 'On hand now; offline cash sales can make it negative.',
        },
        ...stockStatusHelp,
    ],
    reorderLevel:
        'Listed as low stock at or below this level (out of stock included).',
    status: stockStatusHelp,
    reorderQuantity:
        'Suggested amount to order when low; pre-fills restocks and purchase orders.',
} satisfies Record<string, ColumnHelp>;
