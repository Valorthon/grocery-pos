import { Types } from 'mongoose';
import {
    PaymentType,
    ReversalType,
    SaleStatus,
    SalesReportGroup,
    UnitOfMeasure,
    OverrideAction,
    wireShapeDiff,
    SALES_REPORT_SHAPE,
    SALES_REPORT_ROW_SHAPE,
    SALES_REPORT_METRICS_SHAPE,
    SALES_REPORT_RECONCILIATION_SHAPE,
    REPORT_QUANTITY_SHAPE,
    REPORT_OPTIONS_SHAPE,
    type SalesReport,
    type Paginated,
    type SaleRow,
} from '@grocery-pos/contracts';
import {
    bootDbApp,
    caller,
    openShift,
    seedProduct,
    cashSale,
    FLOAT_COUNTS,
    type DbApp,
} from './db-app';
import { ensureApprovalFixtures, approvalHeaders } from './approval-fixtures';
import { Role } from '../../src/auth/types';
import { reportPipeline } from '../../src/reports/reports.service';

let db: DbApp;
const admin = caller('report admin', Role.Admin);
const seller = caller('report cashier', Role.Seller);
const other = caller('other cashier', Role.Seller);
const product = new Types.ObjectId();
const second = new Types.ObjectId();
const category = new Types.ObjectId();
const category2 = new Types.ObjectId();

beforeAll(async () => {
    db = await bootDbApp();
});
afterAll(async () => {
    await db?.close();
});
beforeEach(async () => {
    for (const collection of [
        'sales',
        'salesdetails',
        'products',
        'categories',
        'users',
    ])
        await db.connection.collection(collection).deleteMany({});
    await db.connection.collection('users').insertMany([
        { _id: new Types.ObjectId(seller.userId), name: '\t=Report cashier' },
        { _id: new Types.ObjectId(other.userId), name: 'Other' },
    ]);
    await db.connection.collection('categories').insertMany([
        {
            _id: category,
            name: 'Frozen',
            nameKey: 'frozen',
            isActive: true,
            sortOrder: 0,
        },
        {
            _id: category2,
            name: 'Archived',
            nameKey: 'archived',
            isActive: false,
            sortOrder: 1,
        },
    ]);
    await db.connection.collection('products').insertMany([
        {
            _id: product,
            name: '=Formula milk',
            EAN: '2000000000015',
            category,
            price: 18000,
            unit: UnitOfMeasure.KG,
            isActive: false,
        },
        {
            _id: second,
            name: 'Other',
            EAN: '2000000000022',
            category: category2,
            price: 100,
            unit: UnitOfMeasure.PIECE,
        },
    ]);
});

async function addSale(
    options: {
        id?: Types.ObjectId;
        occurred?: string;
        received?: string;
        reversed?: string;
        kind?: ReversalType;
        cost?: number;
        unknown?: boolean;
        cashier?: string;
        offline?: boolean;
    } = {},
) {
    const id = options.id ?? new Types.ObjectId();
    const occurred = new Date(options.occurred ?? '2026-11-01T05:00Z');
    await db.connection.collection('sales').insertOne({
        _id: id,
        amount: 8000,
        discount: {
            amount: 100,
            type: 'FIXED',
            value: 100,
            reason: 'Promotion',
        },
        cashier: new Types.ObjectId(options.cashier ?? seller.userId),
        paymentType: PaymentType.CASH,
        createdAt: new Date(options.received ?? occurred),
        ...(options.offline
            ? { soldAt: occurred, offline: true, lateOffline: true }
            : {}),
        ...(options.reversed
            ? {
                  status:
                      options.kind === ReversalType.VOID
                          ? SaleStatus.VOIDED
                          : SaleStatus.REFUNDED,
                  reversal: {
                      type: options.kind ?? ReversalType.REFUND,
                      at: new Date(options.reversed),
                      approvedBy: new Types.ObjectId(admin.userId),
                      reason: 'Returned',
                  },
              }
            : { status: SaleStatus.COMPLETED }),
    });
    await db.connection.collection('salesdetails').insertOne({
        _id: new Types.ObjectId(),
        sales: id,
        product,
        quantity: 450,
        unit: UnitOfMeasure.KG,
        unitPrice: 18000,
        ...(options.unknown ? {} : { unitCost: options.cost ?? 10000 }),
    });
    return id;
}
const path = (day = '2026-11-01', extra = '') =>
    `/reports/sales?from=${day}&to=${day}${extra}`;
async function report(day = '2026-11-01', extra = '') {
    const response = await db.call(admin, 'GET', path(day, extra));
    expect(response.status).toBe(200);
    const result = (await response.json()) as SalesReport;
    const clean = { missing: [], unexpected: [] };
    expect(wireShapeDiff(result, SALES_REPORT_SHAPE)).toEqual(clean);
    expect(wireShapeDiff(result.totals, SALES_REPORT_METRICS_SHAPE)).toEqual(
        clean,
    );
    expect(
        wireShapeDiff(result.reconciliation, SALES_REPORT_RECONCILIATION_SHAPE),
    ).toEqual(clean);
    for (const row of result.rows)
        expect(wireShapeDiff(row, SALES_REPORT_ROW_SHAPE)).toEqual(clean);
    for (const row of [result.totals, ...result.rows])
        for (const quantity of row.quantities)
            expect(wireShapeDiff(quantity, REPORT_QUANTITY_SHAPE)).toEqual(
                clean,
            );
    return result;
}

it('enforces admin-only report and CSV access and bounded query validation', async () => {
    const options = await db.call(admin, 'GET', '/reports/options');
    expect(options.status).toBe(200);
    expect(wireShapeDiff(await options.json(), REPORT_OPTIONS_SHAPE)).toEqual({
        missing: [],
        unexpected: [],
    });
    for (const who of [
        seller,
        caller('restocker', Role.Restocker),
        caller('supervisor', Role.Supervisor),
    ]) {
        expect((await db.call(who, 'GET', path())).status).toBe(403);
        expect(
            (
                await db.call(
                    who,
                    'GET',
                    path().replace('/sales?', '/sales.csv?'),
                )
            ).status,
        ).toBe(403);
    }
    for (const query of [
        'from=2026-01-01&to=2027-01-02',
        'from=2026-02-30&to=2026-03-01',
        'from=2026-02-01&to=2026-01-01',
        'groupBy=day',
        'from=2026-01-01&to=2026-01-01&groupBy=private',
    ])
        expect(
            (await db.call(admin, 'GET', `/reports/sales?${query}`)).status,
        ).toBe(400);
});
it('records sales and reversal events on separate dates with original cost snapshots', async () => {
    await addSale({ reversed: '2026-11-02T05:00Z' });
    const first = await report();
    expect(first.totals).toMatchObject({
        grossSales: 8100,
        discounts: 100,
        netSales: 8000,
        knownCogs: 4500,
        grossMargin: 3500,
        transactions: 1,
        reversalTransactions: 0,
    });
    const secondDay = await report('2026-11-02');
    expect(secondDay.totals).toMatchObject({
        grossSales: 0,
        discounts: 0,
        refunds: 8000,
        netSales: -8000,
        knownCogs: -4500,
        grossMargin: -3500,
        transactions: 0,
        reversalTransactions: 1,
    });
    expect(secondDay.reconciliation.priorPeriodReversalAmount).toBe(8000);
    await db.connection
        .collection('products')
        .updateOne({ _id: product }, { $set: { lastCost: 999999 } });
    expect((await report()).totals.knownCogs).toBe(4500);
});
it('uses original offline sale time across timezone boundaries and exposes late-addendum reconciliation', async () => {
    await addSale({
        occurred: '2026-10-31T16:00Z',
        received: '2026-11-04T05:00Z',
        offline: true,
    });
    await addSale({ occurred: '2026-10-31T15:59:59.999Z' });
    await addSale({ occurred: '2026-11-01T16:00Z' });
    const result = await report();
    expect(result.timeZone).toBe('Asia/Manila');
    expect(result.totals.transactions).toBe(1);
    expect(result.reconciliation).toMatchObject({
        lateOfflineTransactions: 1,
        lateOfflineNetSales: 8000,
    });
    expect((await report('2026-11-04')).totals.transactions).toBe(0);
});
it('keeps unknown costs incomplete, but explicit zero known, including refund coverage', async () => {
    await addSale({ unknown: true });
    await addSale({ cost: 0, reversed: '2026-11-02T05:00Z' });
    const result = await report();
    expect(result.totals).toMatchObject({
        netSales: 16000,
        knownCogs: 0,
        knownNetSales: 8000,
        knownGrossMargin: 8000,
        grossMargin: null,
        knownCostLines: 1,
        unknownCostLines: 1,
        costCoverageComplete: false,
    });
    expect((await report('2026-11-02')).totals).toMatchObject({
        grossMargin: -8000,
        costCoverageComplete: true,
    });
});
it('reconciles all grouping/filter totals using exact line-discount allocations and managed categories', async () => {
    const id = await addSale();
    await db.connection
        .collection('sales')
        .updateOne(
            { _id: id },
            { $set: { amount: 8101, discount: { amount: 99 } } },
        );
    await db.connection.collection('salesdetails').insertOne({
        sales: id,
        product: second,
        quantity: 1,
        unitPrice: 100,
        unitCost: 75,
        unit: UnitOfMeasure.PIECE,
    });
    const grouped = [];
    for (const group of Object.values(SalesReportGroup))
        grouped.push(await report('2026-11-01', `&groupBy=${group}`));
    for (const result of grouped) {
        expect(result.totals).toMatchObject({
            grossSales: 8200,
            discounts: 99,
            netSales: 8101,
            knownCogs: 4575,
            transactions: 1,
        });
        expect(result.rows.reduce((sum, row) => sum + row.netSales, 0)).toBe(
            8101,
        );
    }
    const archived = await report(
        '2026-11-01',
        `&groupBy=category&category=${category2.toString()}`,
    );
    expect(archived.rows[0].label).toBe('Archived');
    expect(archived.totals.netSales).toBe(99);
    expect(
        (await report('2026-11-01', `&cashier=${other.userId}`)).totals
            .netSales,
    ).toBe(0);
    expect(
        (await report('2026-11-01', '&paymentType=GCASH')).totals.netSales,
    ).toBe(0);
});
it('streams formula-safe BOM CSV with exact positive/negative money matching report filters', async () => {
    await addSale({ reversed: '2026-11-02T05:00Z' });
    const response = await db.call(
        admin,
        'GET',
        `${path('2026-11-02', '&groupBy=cashier')}`.replace(
            '/sales?',
            '/sales.csv?',
        ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain(
        'sales-2026-11-02',
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
    const text = Buffer.from(bytes).toString('utf8');
    expect(text).toContain('"\'\t=Report cashier"');
    expect(text).toContain('-80.00');
    expect(text).toContain('-45.00');
});
it('filters history by payment, category and exact/full or colliding suffix sale numbers without widening seller scope', async () => {
    const a = new Types.ObjectId('0102030405060708abcdef12');
    const b = new Types.ObjectId('1112131415161718abcdef12');
    await addSale({ id: a });
    await addSale({ id: b, cashier: other.userId });
    const get = async (who = admin, extra = '') => {
        const response = await db.call(
            who,
            'GET',
            `/sales?page=1&limit=10${extra}`,
        );
        expect(response.status).toBe(200);
        return response.json() as Promise<Paginated<SaleRow>>;
    };
    expect((await get(admin, '&saleNumber=ABCDEF12')).totalItems).toBe(2);
    expect((await get(admin, `&saleNumber=${a.toString()}`)).totalItems).toBe(
        1,
    );
    const selected = await get(
        admin,
        `&category=${category.toString()}&paymentType=CASH`,
    );
    expect(selected.totalItems).toBe(2);
    expect(selected.data[0].cashier?.name).toBeDefined();
    expect(JSON.stringify(selected)).not.toContain('requestHash');
    expect(
        (await get(admin, `&category=${category2.toString()}`)).totalItems,
    ).toBe(0);
    expect((await get(seller, '&saleNumber=ABCDEF12')).totalItems).toBe(0); // no open shift
    expect(
        (await db.call(admin, 'GET', '/sales?page=1&limit=10&saleNumber=.*'))
            .status,
    ).toBe(400);
});
it('runs over a full year on indexed date selection without loading unbounded source rows', async () => {
    const sales = [];
    const lines = [];
    for (let n = 0; n < 2000; n++) {
        const id = new Types.ObjectId();
        sales.push({
            _id: id,
            amount: 100,
            cashier: new Types.ObjectId(seller.userId),
            paymentType: PaymentType.CASH,
            createdAt: new Date(Date.UTC(2024, 0, 1 + (n % 366), 12)),
        });
        lines.push({
            sales: id,
            product: second,
            quantity: 1,
            unitPrice: 100,
            unitCost: 50,
        });
    }
    await db.connection.collection('sales').insertMany(sales);
    await db.connection.collection('salesdetails').insertMany(lines);
    const start = Date.now();
    const response = await db.call(
        admin,
        'GET',
        '/reports/sales?from=2024-01-01&to=2024-12-31&groupBy=day',
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as SalesReport;
    expect(result.totals).toMatchObject({
        transactions: 2000,
        netSales: 200000,
        knownCogs: 100000,
    });
    expect(result.rows).toHaveLength(366);
    expect(Date.now() - start).toBeLessThan(20_000);
    const explanation = await db.connection
        .collection('sales')
        .aggregate(
            reportPipeline(
                {
                    from: '2024-01-01',
                    to: '2024-12-31',
                    groupBy: SalesReportGroup.DAY,
                },
                'Asia/Manila',
            ),
        )
        .explain('queryPlanner');
    expect(JSON.stringify(explanation)).toContain('IXSCAN');
});

it('reconciles actual sale charges and later payout events without mutating the original closed Z-read', async () => {
    const actor = caller('shift-report-admin', Role.Admin, Role.Seller);
    await ensureApprovalFixtures(db, actor);
    const originalShift = await openShift(db, actor);
    const item = await seedProduct(db, 1000, 5);
    await db
        .model('Product')
        .updateOne({ _id: item }, { $set: { lastCost: 500 } });
    const sold = await db.call(
        actor,
        'POST',
        '/sales',
        cashSale(item, 1, 1000),
    );
    expect(sold.status).toBe(201);
    const receipt = (await sold.json()) as { _id: string };
    const closed = await db.call(actor, 'POST', '/shifts/current/close', {
        counts: FLOAT_COUNTS,
    });
    expect(closed.status).toBe(201);
    const original = (await closed.json()) as {
        sales: { gross: number; net: number };
    };
    expect(original.sales).toMatchObject({ gross: 1000, net: 1000 });
    const meta = (await (
        await db.call(admin, 'GET', '/reports/options')
    ).json()) as { today: string };
    const before = await report(meta.today);
    expect(before.reconciliation.chargedSales).toBe(original.sales.gross);
    expect(before.totals.netSales).toBe(original.sales.net);
    const payoutShift = await openShift(db, actor);
    const reversal = {
        reason: 'Returned after closing',
        payoutShiftId: payoutShift,
    };
    const headers = await approvalHeaders(db, actor, OverrideAction.REFUND, {
        reversal: { saleId: receipt._id, ...reversal },
    });
    const refund = await db.call(
        actor,
        'POST',
        `/sales/${receipt._id}/refund`,
        reversal,
        headers,
    );
    expect(refund.status).toBe(201);
    const after = await report(meta.today);
    expect(after.totals).toMatchObject({
        grossSales: 1000,
        refunds: 1000,
        netSales: 0,
        knownCogs: 0,
    });
    expect(
        after.reconciliation.chargedSales - after.reconciliation.reversalAmount,
    ).toBe(after.totals.netSales);
    const unchanged = (await (
        await db.call(actor, 'GET', `/shifts/${originalShift}`)
    ).json()) as { report: { sales: { net: number } } };
    expect(unchanged.report.sales.net).toBe(1000);
    const ledger = await db.connection
        .collection('shifts')
        .findOne({ _id: new Types.ObjectId(payoutShift) });
    expect(ledger?.movements).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ amount: 1000, type: 'REVERSAL_PAYOUT' }),
        ]),
    );
});
