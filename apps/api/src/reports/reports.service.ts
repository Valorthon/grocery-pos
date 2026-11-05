import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type PipelineStage } from 'mongoose';
import {
    REPORT_LIMITS,
    SalesReportGroup,
    ReversalType,
    SaleStatus,
    type ReportOptions,
    type SalesReport,
    type SalesReportRow,
} from '@grocery-pos/contracts';
import { Sales } from '../sales/sales.schema';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { dateRangeFilter, calendarDateInZone } from '../common/utils/timezone';
import { ErrorCode, ValidationError, InternalError } from '../common/errors';
import { SalesReportQuery } from './reports.dto';
import {
    addLine,
    allocateDiscount,
    emptyMetrics,
    exactSum,
    lineGross,
    type ReportLine,
} from './report-math';

export interface ReportSale {
    _id: Types.ObjectId;
    amount: number;
    soldAt?: Date;
    createdAt: Date;
    paymentType: string;
    cashierId: string;
    cashierName: string;
    discount?: { amount: number };
    reversal?: { type: ReversalType; at: Date };
    status?: SaleStatus;
    lateOffline?: boolean;
    lines: ReportLine[];
}
/** Indexable occurrence/reversal union precedes every lookup or unwind. */
export function reportPipeline(
    dto: SalesReportQuery,
    timeZone: string,
): PipelineStage[] {
    const range = dateRangeFilter(dto.from, dto.to, timeZone)!;
    return [
        {
            $match: {
                ...(dto.cashier
                    ? { cashier: new Types.ObjectId(dto.cashier) }
                    : {}),
                ...(dto.paymentType ? { paymentType: dto.paymentType } : {}),
                $or: [
                    { soldAt: range },
                    { soldAt: { $exists: false }, createdAt: range },
                    { 'reversal.at': range },
                ],
            },
        },
        {
            $lookup: {
                from: 'users',
                localField: 'cashier',
                foreignField: '_id',
                pipeline: [{ $project: { name: 1 } }],
                as: 'cashierRef',
            },
        },
        {
            $lookup: {
                from: 'salesdetails',
                localField: '_id',
                foreignField: 'sales',
                as: 'lines',
                pipeline: [
                    { $sort: { _id: 1 } },
                    {
                        $lookup: {
                            from: 'products',
                            localField: 'product',
                            foreignField: '_id',
                            pipeline: [{ $project: { name: 1, category: 1 } }],
                            as: 'productRef',
                        },
                    },
                    {
                        $set: {
                            productRef: { $arrayElemAt: ['$productRef', 0] },
                        },
                    },
                    {
                        $lookup: {
                            from: 'categories',
                            localField: 'productRef.category',
                            foreignField: '_id',
                            pipeline: [{ $project: { name: 1 } }],
                            as: 'categoryRef',
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            id: { $toString: '$_id' },
                            productId: { $toString: '$product' },
                            productName: {
                                $ifNull: [
                                    '$productRef.name',
                                    'Unavailable product',
                                ],
                            },
                            categoryId: {
                                $ifNull: [
                                    { $toString: '$productRef.category' },
                                    'uncategorized',
                                ],
                            },
                            categoryName: {
                                $ifNull: [
                                    { $arrayElemAt: ['$categoryRef.name', 0] },
                                    'Uncategorized',
                                ],
                            },
                            quantity: 1,
                            unit: 1,
                            unitPrice: 1,
                            unitCost: 1,
                        },
                    },
                ],
            },
        },
        {
            $project: {
                amount: 1,
                soldAt: 1,
                createdAt: 1,
                paymentType: 1,
                discount: { amount: 1 },
                reversal: { type: 1, at: 1 },
                status: 1,
                lateOffline: 1,
                cashierId: { $toString: '$cashier' },
                cashierName: {
                    $ifNull: [
                        { $arrayElemAt: ['$cashierRef.name', 0] },
                        'Unavailable cashier',
                    ],
                },
                lines: 1,
            },
        },
    ];
}
function isoDay(date: Date, zone: string): string {
    const d = calendarDateInZone(date, zone);
    return `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}
function groupFor(
    group: SalesReportGroup,
    sale: ReportSale,
    line: ReportLine,
    at: Date,
    zone: string,
): { key: string; label: string } {
    switch (group) {
        case SalesReportGroup.PRODUCT:
            return { key: line.productId, label: line.productName };
        case SalesReportGroup.CATEGORY:
            return { key: line.categoryId, label: line.categoryName };
        case SalesReportGroup.CASHIER:
            return { key: sale.cashierId, label: sale.cashierName };
        case SalesReportGroup.PAYMENT_TYPE:
            return { key: sale.paymentType, label: sale.paymentType };
        case SalesReportGroup.DAY:
            return { key: isoDay(at, zone), label: isoDay(at, zone) };
    }
}
/** Bounded streaming reduction of the date-indexed database cursor. */
export async function buildSalesReport(
    sales: AsyncIterable<ReportSale>,
    dto: SalesReportQuery,
    timeZone: string,
): Promise<SalesReport> {
    const range = dateRangeFilter(dto.from, dto.to, timeZone)!;
    const within = (date: Date) => date >= range.$gte! && date < range.$lt!;
    const report: SalesReport = {
        from: dto.from,
        to: dto.to,
        timeZone,
        groupBy: dto.groupBy,
        accountingBasis: 'EVENT_DATE',
        costBasis: 'LATEST_RECEIPT',
        generatedAt: new Date().toISOString(),
        rows: [],
        totals: emptyMetrics(),
        reconciliation: {
            lateOfflineTransactions: 0,
            lateOfflineNetSales: 0,
            priorPeriodReversals: 0,
            priorPeriodReversalAmount: 0,
            chargedSales: 0,
            reversalAmount: 0,
            note: 'Sales use their original occurrence date; reversals use the date they happened. Gross sales less discounts equals original charged sales. Net sales then subtracts reversal events. Original shift Z-reads are immutable closing snapshots: compare original charges, drawer payout movements, and separate late-offline addenda, not an unadjusted calendar-period net. Category/product groups count a transaction in each group it touches; totals count it once. Categories use current product assignments. SPLIT is one payment-type group. Product costs use the latest-receipt estimate; unknown cost coverage is explicit.',
        },
    };
    const rows = new Map<string, SalesReportRow>();
    for await (const sale of sales) {
        const occurred = sale.soldAt ?? sale.createdAt;
        const reversal = sale.reversal;
        if (!sale.lines.length)
            throw new InternalError('Sale has no reportable detail lines');
        const gross = sale.lines.map(lineGross);
        const discount = sale.discount?.amount ?? 0;
        if (exactSum(gross.reduce(exactSum, 0), -discount) !== sale.amount)
            throw new InternalError(
                'Sale detail totals do not match recorded amount',
            );
        const allocated = allocateDiscount(gross, discount);
        const selected = sale.lines
            .map((line, index) => ({ line, discount: allocated[index] }))
            .filter(
                ({ line }) =>
                    !dto.category ||
                    line.categoryId === dto.category.toLowerCase(),
            );
        if (!selected.length) continue;
        if (
            (sale.status === SaleStatus.REFUNDED ||
                sale.status === SaleStatus.VOIDED) &&
            !reversal?.at
        )
            throw new InternalError('Reversed sale has no occurrence time');
        for (const event of [
            ...(within(occurred)
                ? [{ kind: 'SALE' as const, at: occurred }]
                : []),
            ...(reversal && within(reversal.at)
                ? [
                      {
                          kind:
                              reversal.type === ReversalType.VOID
                                  ? ('VOID' as const)
                                  : ('REFUND' as const),
                          at: reversal.at,
                      },
                  ]
                : []),
        ]) {
            const touched = new Set<SalesReportRow>();
            let eventNet = 0;
            for (const { line, discount: lineDiscount } of selected) {
                const group = groupFor(
                    dto.groupBy,
                    sale,
                    line,
                    event.at,
                    timeZone,
                );
                let row = rows.get(group.key);
                if (!row) {
                    if (rows.size >= REPORT_LIMITS.GROUPS_MAX)
                        throw new ValidationError(
                            ErrorCode.VALIDATION_INVALID_INPUT,
                            'Report has too many groups; narrow its filters',
                        );
                    row = { ...emptyMetrics(), ...group };
                    rows.set(group.key, row);
                }
                addLine(row, line, lineDiscount, event.kind);
                addLine(report.totals, line, lineDiscount, event.kind);
                touched.add(row);
                eventNet = exactSum(eventNet, lineGross(line) - lineDiscount);
            }
            for (const metrics of [...touched, report.totals]) {
                if (event.kind === 'SALE') metrics.transactions += 1;
                else metrics.reversalTransactions += 1;
            }
            if (event.kind === 'SALE') {
                report.reconciliation.chargedSales = exactSum(
                    report.reconciliation.chargedSales,
                    eventNet,
                );
                if (sale.lateOffline) {
                    report.reconciliation.lateOfflineTransactions += 1;
                    report.reconciliation.lateOfflineNetSales = exactSum(
                        report.reconciliation.lateOfflineNetSales,
                        eventNet,
                    );
                }
            } else {
                report.reconciliation.reversalAmount = exactSum(
                    report.reconciliation.reversalAmount,
                    eventNet,
                );
                if (!within(occurred)) {
                    report.reconciliation.priorPeriodReversals += 1;
                    report.reconciliation.priorPeriodReversalAmount = exactSum(
                        report.reconciliation.priorPeriodReversalAmount,
                        eventNet,
                    );
                }
            }
        }
    }
    report.rows = [...rows.values()].sort((a, b) =>
        dto.groupBy === SalesReportGroup.DAY
            ? a.key.localeCompare(b.key)
            : b.netSales - a.netSales || a.key.localeCompare(b.key),
    );
    return report;
}

@Injectable()
export class ReportsService {
    constructor(
        @InjectModel(Sales.name) private sales: Model<Sales>,
        private config: TypedConfigService,
    ) {}
    options(): ReportOptions {
        const timeZone = this.config.get('STORE_TIMEZONE');
        return {
            timeZone,
            today: isoDay(new Date(), timeZone),
            maxDays: REPORT_LIMITS.DAYS_MAX,
        };
    }

    async salesReport(dto: SalesReportQuery): Promise<SalesReport> {
        const timeZone = this.config.get('STORE_TIMEZONE');
        const cursor = this.sales
            .aggregate<ReportSale>(reportPipeline(dto, timeZone))
            .allowDiskUse(true)
            .option({ maxTimeMS: 30_000 })
            .cursor({ batchSize: 200 });
        try {
            return await buildSalesReport(cursor, dto, timeZone);
        } finally {
            await cursor.close();
        }
    }
}
