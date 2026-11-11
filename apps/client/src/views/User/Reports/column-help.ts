import type { ColumnHelp } from '@/components/ui/types';

/**
 * Column help for the sales report (#263). Event-date accounting (#44):
 * sales on the sale's own date, reversals on the date they happened.
 */
export const REPORT_HELP = {
    transactions:
        'Sale events / void-refund events. One sale can count in several groups.',
    quantities: 'Sold minus reversed, kept per unit.',
    grossSales:
        'Line totals before discounts, on the date of the sale (offline sales on the date they happened).',
    voids: 'Voided sales after their discount, on the date of the void.',
    refunds: 'Refunded sales after their discount, on the date of the refund.',
    netSales: 'Gross − discounts − voids − refunds.',
    knownCogs:
        'Latest-receipt cost of the lines whose cost is known, less the cost of reversed lines.',
    grossMargin:
        'Net − known COGS. "Incomplete" when any line\'s cost is unknown.',
} satisfies Record<string, ColumnHelp>;
