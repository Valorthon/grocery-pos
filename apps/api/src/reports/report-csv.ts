import {
    UnitOfMeasure,
    quantityInput,
    type SalesReport,
    type SalesReportMetrics,
} from '@grocery-pos/contracts';
import { csvCell, csvMoney, csvRow } from './csv';

/** Safe monetary columns are generated from integer centavos, never user text. */
function row(key: string, label: string, m: SalesReportMetrics): string {
    return (
        [
            csvCell(key),
            csvCell(label),
            m.transactions,
            m.reversalTransactions,
            ...[
                m.grossSales,
                m.discounts,
                m.voids,
                m.refunds,
                m.netSales,
                m.knownCogs,
                m.knownNetSales,
                m.knownGrossMargin,
            ].map(csvMoney),
            m.grossMargin === null ? '' : csvMoney(m.grossMargin),
            m.knownCostLines,
            m.unknownCostLines,
            csvCell(m.costCoverageComplete ? 'complete' : 'incomplete'),
            ...Object.values(UnitOfMeasure).map((unit) =>
                quantityInput(
                    m.quantities.find((q) => q.unit === unit)?.net ?? 0,
                    unit,
                ),
            ),
        ].join(',') + '\r\n'
    );
}
export function* salesReportCsv(report: SalesReport): Generator<string> {
    yield '\ufeff';
    yield csvRow([
        'Group ID / ISO day',
        'Group',
        'Transactions',
        'Reversals',
        'Gross sales PHP',
        'Discounts PHP',
        'Voids PHP',
        'Refunds PHP',
        'Net sales PHP',
        'Known COGS PHP',
        'Known-cost net sales PHP',
        'Known gross margin PHP',
        'Complete gross margin PHP',
        'Known cost lines',
        'Unknown cost lines',
        'Cost coverage',
        ...Object.values(UnitOfMeasure).map((unit) => `Net quantity ${unit}`),
    ]);
    for (const item of report.rows) yield row(item.key, item.label, item);
    yield row('TOTAL', 'All matching events', report.totals);
}
