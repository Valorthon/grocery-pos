/** Report dates are inclusive calendar dates in the store timezone. */
export enum SalesReportGroup {
    DAY = 'day',
    PRODUCT = 'product',
    CATEGORY = 'category',
    CASHIER = 'cashier',
    PAYMENT_TYPE = 'paymentType',
}

export const REPORT_LIMITS = {
    /** Includes an entire leap year, with both dates inclusive. */
    DAYS_MAX: 366,
    GROUPS_MAX: 10_000,
    /** Full ObjectId or the receipt's final eight hexadecimal characters. */
    SALE_SEARCH: /^(?:[a-f\d]{8}|[a-f\d]{24})$/i,
} as const;

import type { UnitOfMeasure } from './enums.js';
import type { WireShape } from './wire-shape.js';

export interface ReportQuantity {
    unit: UnitOfMeasure;
    /** Integer minor units, separated by measure rather than mixed totals. */
    sold: number;
    reversed: number;
    net: number;
}
export const REPORT_QUANTITY_SHAPE: WireShape<ReportQuantity> = {
    unit: 'required',
    sold: 'required',
    reversed: 'required',
    net: 'required',
};
export interface SalesReportMetrics {
    transactions: number;
    reversalTransactions: number;
    grossSales: number;
    discounts: number;
    voids: number;
    refunds: number;
    netSales: number;
    /** Signed cost for known-cost lines only. Never implies complete coverage. */
    knownCogs: number;
    knownNetSales: number;
    knownGrossMargin: number;
    /** Null if any contributing sale/reversal line has unknown cost. */
    grossMargin: number | null;
    knownCostLines: number;
    unknownCostLines: number;
    costCoverageComplete: boolean;
    quantities: ReportQuantity[];
}
export const SALES_REPORT_METRICS_SHAPE: WireShape<SalesReportMetrics> = {
    transactions: 'required',
    reversalTransactions: 'required',
    grossSales: 'required',
    discounts: 'required',
    voids: 'required',
    refunds: 'required',
    netSales: 'required',
    knownCogs: 'required',
    knownNetSales: 'required',
    knownGrossMargin: 'required',
    grossMargin: 'required',
    knownCostLines: 'required',
    unknownCostLines: 'required',
    costCoverageComplete: 'required',
    quantities: 'required',
};
export interface SalesReportRow extends SalesReportMetrics {
    key: string;
    label: string;
}
export const SALES_REPORT_ROW_SHAPE: WireShape<SalesReportRow> = {
    ...SALES_REPORT_METRICS_SHAPE,
    key: 'required',
    label: 'required',
};
export interface SalesReportReconciliation {
    /** Sale occurrences in the report received after a closed-shift snapshot. */
    lateOfflineTransactions: number;
    lateOfflineNetSales: number;
    /** Reversal events whose original sale occurred outside the selected range. */
    priorPeriodReversals: number;
    priorPeriodReversalAmount: number;
    /** Original sale net charges (gross less discounts), before reversal events. */
    chargedSales: number;
    reversalAmount: number;
    note: string;
}
export const SALES_REPORT_RECONCILIATION_SHAPE: WireShape<SalesReportReconciliation> =
    {
        lateOfflineTransactions: 'required',
        lateOfflineNetSales: 'required',
        priorPeriodReversals: 'required',
        priorPeriodReversalAmount: 'required',
        chargedSales: 'required',
        reversalAmount: 'required',
        note: 'required',
    };
export interface SalesReport {
    from: string;
    to: string;
    timeZone: string;
    groupBy: SalesReportGroup;
    accountingBasis: 'EVENT_DATE';
    costBasis: 'LATEST_RECEIPT';
    generatedAt: string;
    rows: SalesReportRow[];
    totals: SalesReportMetrics;
    reconciliation: SalesReportReconciliation;
}
export const SALES_REPORT_SHAPE: WireShape<SalesReport> = {
    from: 'required',
    to: 'required',
    timeZone: 'required',
    groupBy: 'required',
    accountingBasis: 'required',
    costBasis: 'required',
    generatedAt: 'required',
    rows: 'required',
    totals: 'required',
    reconciliation: 'required',
};
export interface ReportOptions {
    timeZone: string;
    today: string;
    maxDays: number;
}
export const REPORT_OPTIONS_SHAPE: WireShape<ReportOptions> = {
    timeZone: 'required',
    today: 'required',
    maxDays: 'required',
};

/**
 * The sales report's reconciliation explanation, one point per line (#216).
 * The API sends them joined by a space as `reconciliation.note`; the client
 * shows them as bullets.
 */
export const SALES_REPORT_RECONCILIATION_NOTES: readonly string[] = [
    'Sales use their original occurrence date; reversals use the date they happened.',
    'Gross sales less discounts equals original charged sales. Net sales then subtracts reversal events.',
    'Original shift Z-reads are immutable closing snapshots: compare original charges, drawer payout movements, and separate late-offline addenda, not an unadjusted calendar-period net.',
    'Category/product groups count a transaction in each group it touches; totals count it once.',
    'Categories use current product assignments.',
    'SPLIT is one payment-type group.',
    'Product costs use the latest-receipt estimate; unknown cost coverage is explicit.',
];
