import { StockCountStatus } from '@grocery-pos/contracts';
import type { StatusMap } from '@/components/ui/status-badge';
import { statusHelp } from '@/components/ui/column-help';
import type { ColumnHelp } from '@/components/ui/types';

export const STOCK_COUNT_STATUS: StatusMap<StockCountStatus> = {
    [StockCountStatus.OPEN]: { label: 'Open', color: 'info' },
    [StockCountStatus.SUBMITTED]: { label: 'Submitted', color: 'warning' },
    [StockCountStatus.APPROVED]: { label: 'Approved', color: 'success' },
    [StockCountStatus.CANCELLED]: { label: 'Cancelled', color: 'neutral' },
};

/** Column help for stock counts and their lines (#263). */
export const STOCK_COUNT_HELP = {
    status: statusHelp(STOCK_COUNT_STATUS, {
        [StockCountStatus.OPEN]: 'Counting in progress.',
        [StockCountStatus.SUBMITTED]:
            "Quantities frozen, awaiting an admin's or supervisor's PIN.",
        [StockCountStatus.APPROVED]:
            'Nonzero differences posted as one adjustment (none when every count matched).',
        [StockCountStatus.CANCELLED]: 'Closed, nothing posted.',
    }),
    lines: 'Products or batches in the count (at most 200).',
    opening: 'Expected stock when the count was opened; it never changes.',
    current: 'Stock now, including movements since the count was opened.',
    variance:
        'Counted minus opening: what approval posts. "Not counted" until a quantity is entered; enter 0 for an empty shelf.',
    projected: 'Current stock after the variance is applied.',
} satisfies Record<string, ColumnHelp>;
