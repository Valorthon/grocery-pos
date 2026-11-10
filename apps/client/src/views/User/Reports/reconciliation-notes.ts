/**
 * The report's reconciliation explanation, one point per bullet (#216).
 * Same wording as the server's `reconciliation.note` (reports.service.ts);
 * keep the two in step.
 */
export const RECONCILIATION_NOTES: readonly string[] = [
    'Sales use their original occurrence date; reversals use the date they happened.',
    'Gross sales less discounts equals original charged sales. Net sales then subtracts reversal events.',
    'Original shift Z-reads are immutable closing snapshots: compare original charges, drawer payout movements, and separate late-offline addenda, not an unadjusted calendar-period net.',
    'Category/product groups count a transaction in each group it touches; totals count it once.',
    'Categories use current product assignments.',
    'SPLIT is one payment-type group.',
    'Product costs use the latest-receipt estimate; unknown cost coverage is explicit.',
];
