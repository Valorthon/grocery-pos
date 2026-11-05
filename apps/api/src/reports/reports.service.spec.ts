import { Types } from 'mongoose';
import {
    SalesReportGroup,
    UnitOfMeasure,
    ReversalType,
    SaleStatus,
    PaymentType,
} from '@grocery-pos/contracts';
import {
    buildSalesReport,
    reportPipeline,
    type ReportSale,
} from './reports.service';
import { SalesReportQuery } from './reports.dto';
import { allocateDiscount, exactSum } from './report-math';
import { salesReportCsv } from './report-csv';

const query = (
    from = '2026-11-01',
    to = from,
    groupBy = SalesReportGroup.DAY,
): SalesReportQuery => ({ from, to, groupBy });
const line = (id: string, price: number, cost?: number) => ({
    id,
    productId: id,
    productName: `Product ${id}`,
    categoryId: '0123456789abcdef01234567',
    categoryName: 'Frozen',
    quantity: 1,
    unit: UnitOfMeasure.PIECE,
    unitPrice: price,
    ...(cost === undefined ? {} : { unitCost: cost }),
});
function sale(overrides: Partial<ReportSale> = {}): ReportSale {
    return {
        _id: new Types.ObjectId(),
        amount: 202,
        createdAt: new Date('2026-11-01T05:00Z'),
        paymentType: PaymentType.SPLIT,
        cashierId: 'abc',
        cashierName: 'Cashier',
        discount: { amount: 101 },
        lines: [line('a', 101, 75), line('b', 202, 150)],
        ...overrides,
    };
}
async function* source(...sales: ReportSale[]) {
    yield* sales;
}

describe('exact report math', () => {
    it('allocates exact cents with stable largest remainders', () => {
        expect(allocateDiscount([101, 202], 101)).toEqual([34, 67]);
        expect(allocateDiscount([1, 1, 1], 2)).toEqual([1, 1, 0]);
        expect(allocateDiscount([0, 0], 0)).toEqual([0, 0]);
        expect(allocateDiscount([0, 10], 10)).toEqual([0, 10]);
    });
    it('does not lose precision in the proportional product', () => {
        const n = 1_000_000_001;
        const parts = allocateDiscount([n, n, n], n);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(n);
        expect(Math.max(...parts) - Math.min(...parts)).toBe(1);
    });
    it.each([
        [[-1], 0],
        [[1.1], 0],
        [[1], 2],
        [[1], -1],
    ])('rejects invalid allocation', (gross, discount) => {
        expect(() =>
            allocateDiscount(gross as number[], discount as number),
        ).toThrow(RangeError);
    });
    it('rejects unsafe aggregation instead of rounded money', () => {
        expect(() => exactSum(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
    });
});

describe('event-date sales reports', () => {
    it('includes the original sale even after a later refund; reports refund on its own day', async () => {
        const original = sale({
            status: SaleStatus.REFUNDED,
            reversal: {
                type: ReversalType.REFUND,
                at: new Date('2026-11-02T05:00Z'),
            },
        });
        const first = await buildSalesReport(
            source(original),
            query(),
            'Asia/Manila',
        );
        expect(first.totals).toMatchObject({
            transactions: 1,
            reversalTransactions: 0,
            grossSales: 303,
            discounts: 101,
            netSales: 202,
            knownCogs: 225,
            grossMargin: -23,
        });
        const second = await buildSalesReport(
            source(original),
            query('2026-11-02'),
            'Asia/Manila',
        );
        expect(second.totals).toMatchObject({
            transactions: 0,
            reversalTransactions: 1,
            grossSales: 0,
            refunds: 202,
            netSales: -202,
            knownCogs: -225,
            grossMargin: 23,
        });
        expect(second.reconciliation).toMatchObject({
            priorPeriodReversals: 1,
            priorPeriodReversalAmount: 202,
            chargedSales: 0,
            reversalAmount: 202,
        });
        const combined = await buildSalesReport(
            source(original),
            query('2026-11-01', '2026-11-02'),
            'Asia/Manila',
        );
        expect(combined.totals.netSales).toBe(0);
        expect(combined.totals.knownCogs).toBe(0);
    });
    it('allocates discount to product/category groups before filtering', async () => {
        const s = sale();
        s.lines[1].categoryId = 'abcdef0123456789abcdef01';
        s.lines[1].categoryName = 'Archived category';
        const report = await buildSalesReport(
            source(s),
            query('2026-11-01', undefined, SalesReportGroup.PRODUCT),
            'Asia/Manila',
        );
        expect(
            report.rows.map((r) => [
                r.key,
                r.grossSales,
                r.discounts,
                r.netSales,
            ]),
        ).toEqual([
            ['b', 202, 67, 135],
            ['a', 101, 34, 67],
        ]);
        expect(report.totals.transactions).toBe(1);
        const filtered = await buildSalesReport(
            source(s),
            {
                ...query('2026-11-01', undefined, SalesReportGroup.CATEGORY),
                category: s.lines[1].categoryId,
            },
            'Asia/Manila',
        );
        expect(filtered.totals).toMatchObject({
            grossSales: 202,
            discounts: 67,
            netSales: 135,
            knownCogs: 150,
        });
    });
    it.each([
        SalesReportGroup.CASHIER,
        SalesReportGroup.PAYMENT_TYPE,
        SalesReportGroup.CATEGORY,
    ])(
        'counts one transaction despite multiple lines for %s',
        async (group) => {
            const report = await buildSalesReport(
                source(sale()),
                query('2026-11-01', undefined, group),
                'Asia/Manila',
            );
            expect(report.rows).toHaveLength(1);
            expect(report.rows[0].transactions).toBe(1);
        },
    );
    it('separates measured quantities, treats explicit zero as known, and marks unknown coverage', async () => {
        const report = await buildSalesReport(
            source(
                sale({
                    amount: 8200,
                    discount: undefined,
                    lines: [
                        {
                            ...line('milk', 18000, 0),
                            quantity: 450,
                            unit: UnitOfMeasure.KG,
                        },
                        line('pc', 100),
                    ],
                }),
            ),
            query(),
            'Asia/Manila',
        );
        expect(report.totals).toMatchObject({
            netSales: 8200,
            knownCogs: 0,
            knownNetSales: 8100,
            knownGrossMargin: 8100,
            grossMargin: null,
            knownCostLines: 1,
            unknownCostLines: 1,
            costCoverageComplete: false,
        });
        expect(report.totals.quantities).toEqual([
            { unit: UnitOfMeasure.KG, sold: 450, reversed: 0, net: 450 },
            { unit: UnitOfMeasure.PIECE, sold: 1, reversed: 0, net: 1 },
        ]);
    });
    it('uses offline original occurrence, not server receive date, at timezone midnight', async () => {
        const s = sale({
            soldAt: new Date('2026-10-31T16:00Z'),
            createdAt: new Date('2026-11-04T05:00Z'),
            lateOffline: true,
        });
        const report = await buildSalesReport(
            source(s),
            query(),
            'Asia/Manila',
        );
        expect(report.rows[0].key).toBe('2026-11-01');
        expect(report.reconciliation).toMatchObject({
            lateOfflineTransactions: 1,
            lateOfflineNetSales: 202,
        });
    });
    it('records void reversals separately and respects exclusive next midnight', async () => {
        const s = sale({
            createdAt: new Date('2026-10-31T15:59:59.999Z'),
            status: SaleStatus.VOIDED,
            reversal: {
                type: ReversalType.VOID,
                at: new Date('2026-11-01T16:00Z'),
            },
        });
        expect(
            (await buildSalesReport(source(s), query(), 'Asia/Manila')).totals
                .netSales,
        ).toBe(0);
        expect(
            (
                await buildSalesReport(
                    source(s),
                    query('2026-11-02'),
                    'Asia/Manila',
                )
            ).totals.voids,
        ).toBe(202);
    });
    it('refuses inconsistent financial source data instead of silently dropping money', async () => {
        await expect(
            buildSalesReport(source(sale({ lines: [] })), query(), 'UTC'),
        ).rejects.toThrow('no reportable');
        await expect(
            buildSalesReport(source(sale({ amount: 1 })), query(), 'UTC'),
        ).rejects.toThrow('do not match');
        await expect(
            buildSalesReport(
                source(sale({ status: SaleStatus.VOIDED })),
                query(),
                'UTC',
            ),
        ).rejects.toThrow('no occurrence');
    });
    it('matches indexed date branches before joins and never matches status to erase later reversals', () => {
        const stages = reportPipeline(
            {
                ...query(),
                cashier: '0123456789abcdef01234567',
                paymentType: PaymentType.CASH,
            },
            'Asia/Manila',
        );
        expect(stages[0]).toMatchObject({
            $match: {
                cashier: expect.any(Types.ObjectId),
                paymentType: PaymentType.CASH,
                $or: expect.arrayContaining([
                    expect.objectContaining({
                        'reversal.at': expect.any(Object),
                    }),
                ]),
            },
        });
        expect(JSON.stringify(stages[0])).not.toContain('status');
    });
    it('exports BOM, quoted formula-safe labels and exact negative decimal money', async () => {
        const s = sale({
            cashierName: '\t=evil',
            reversal: {
                type: ReversalType.REFUND,
                at: new Date('2026-11-02T05:00Z'),
            },
        });
        const report = await buildSalesReport(
            source(s),
            query('2026-11-02', undefined, SalesReportGroup.CASHIER),
            'Asia/Manila',
        );
        const csv = [...salesReportCsv(report)].join('');
        expect(csv.startsWith('\ufeff')).toBe(true);
        expect(csv).toContain('"\'\t=evil"');
        expect(csv).toContain('-2.02');
        expect(csv).toContain('-2.25');
        expect(csv).not.toContain("'-2.02");
    });
});

it('treats null as unknown but rejects corrupt stored costs', async () => {
    const unknown = sale();
    Object.assign(unknown.lines[0], { unitCost: null });
    expect(
        (await buildSalesReport(source(unknown), query(), 'UTC')).totals
            .grossMargin,
    ).toBeNull();
    const corrupt = sale();
    corrupt.lines[0].unitCost = -1;
    await expect(
        buildSalesReport(source(corrupt), query(), 'UTC'),
    ).rejects.toThrow('Invalid stored receipt cost');
});
it('rejects excess groups rather than returning a truncated partial report', async () => {
    async function* many() {
        for (let n = 0; n < 10001; n++) {
            const s = sale();
            s.lines[0].productId = String(n);
            yield s;
        }
    }
    await expect(
        buildSalesReport(
            many(),
            query('2026-11-01', undefined, SalesReportGroup.PRODUCT),
            'UTC',
        ),
    ).rejects.toThrow('too many groups');
});
