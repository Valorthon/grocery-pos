import { receiptCost } from '../supplier/cost';
import {
    quantityAmount,
    unitOf,
    UnitOfMeasure,
    type SalesReportMetrics,
} from '@grocery-pos/contracts';

export function exactSum(a: number, b: number): number {
    const result = a + b;
    if (!Number.isSafeInteger(result))
        throw new RangeError('Report total exceeds safe bounds');
    return result;
}

/** Proportional whole-cent discounts; largest remainders win, then stable line order. */
export function allocateDiscount(
    gross: readonly number[],
    discount: number,
): number[] {
    if (
        !Number.isSafeInteger(discount) ||
        discount < 0 ||
        gross.some((n) => !Number.isSafeInteger(n) || n < 0)
    )
        throw new RangeError('Invalid report amounts');
    const total = gross.reduce(exactSum, 0);
    if (discount > total)
        throw new RangeError('Discount exceeds report subtotal');
    if (!total) return gross.map(() => 0);
    const denominator = BigInt(total);
    const parts = gross.map((n, index) => {
        const product = BigInt(n) * BigInt(discount);
        return {
            index,
            amount: Number(product / denominator),
            remainder: product % denominator,
        };
    });
    let remaining =
        discount - parts.reduce((sum, row) => exactSum(sum, row.amount), 0);
    const ranked = [...parts].sort((a, b) =>
        a.remainder > b.remainder
            ? -1
            : a.remainder < b.remainder
              ? 1
              : a.index - b.index,
    );
    for (const row of ranked) {
        if (!remaining) break;
        row.amount += 1;
        remaining -= 1;
    }
    return parts.map((row) => row.amount);
}

export function emptyMetrics(): SalesReportMetrics {
    return {
        transactions: 0,
        reversalTransactions: 0,
        grossSales: 0,
        discounts: 0,
        voids: 0,
        refunds: 0,
        netSales: 0,
        knownCogs: 0,
        knownNetSales: 0,
        knownGrossMargin: 0,
        grossMargin: 0,
        knownCostLines: 0,
        unknownCostLines: 0,
        costCoverageComplete: true,
        quantities: [],
    };
}

export interface ReportLine {
    id: string;
    productId: string;
    productName: string;
    categoryId: string;
    categoryName: string;
    quantity: number;
    unit?: UnitOfMeasure;
    unitPrice: number;
    unitCost?: number;
}
export function lineGross(line: ReportLine): number {
    return quantityAmount(line.unitPrice, line.quantity, line.unit);
}
export function addLine(
    metrics: SalesReportMetrics,
    line: ReportLine,
    discount: number,
    kind: 'SALE' | 'VOID' | 'REFUND',
): void {
    const gross = lineGross(line);
    const net = gross - discount;
    const sign = kind === 'SALE' ? 1 : -1;
    if (kind === 'SALE') {
        metrics.grossSales = exactSum(metrics.grossSales, gross);
        metrics.discounts = exactSum(metrics.discounts, discount);
    } else if (kind === 'VOID') metrics.voids = exactSum(metrics.voids, net);
    else metrics.refunds = exactSum(metrics.refunds, net);
    metrics.netSales = exactSum(metrics.netSales, sign * net);
    const unitCost = receiptCost(line.unitCost);
    if (unitCost !== undefined) {
        metrics.knownCostLines += 1;
        metrics.knownCogs = exactSum(
            metrics.knownCogs,
            sign * quantityAmount(unitCost, line.quantity, line.unit),
        );
        metrics.knownNetSales = exactSum(metrics.knownNetSales, sign * net);
    } else metrics.unknownCostLines += 1;
    const unit = unitOf(line.unit);
    let quantity = metrics.quantities.find((q) => q.unit === unit);
    if (!quantity) {
        quantity = { unit, sold: 0, reversed: 0, net: 0 };
        metrics.quantities.push(quantity);
        metrics.quantities.sort((a, b) => a.unit.localeCompare(b.unit));
    }
    if (kind === 'SALE') quantity.sold = exactSum(quantity.sold, line.quantity);
    else quantity.reversed = exactSum(quantity.reversed, line.quantity);
    quantity.net = exactSum(quantity.net, sign * line.quantity);
    metrics.costCoverageComplete = metrics.unknownCostLines === 0;
    metrics.knownGrossMargin = exactSum(
        metrics.knownNetSales,
        -metrics.knownCogs,
    );
    metrics.grossMargin = metrics.costCoverageComplete
        ? metrics.knownGrossMargin
        : null;
}
