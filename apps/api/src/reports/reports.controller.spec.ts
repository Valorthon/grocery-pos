import { settingsMock } from '../common/testing/business-collaborators';
import { SettingsService } from '../settings/settings.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { SalesReportGroup, type SalesReport } from '@grocery-pos/contracts';
import { emptyMetrics } from './report-math';
import type { Model } from 'mongoose';
import type { Sales } from '../sales/sales.schema';

const query = {
    from: '2026-11-01',
    to: '2026-11-01',
    groupBy: SalesReportGroup.DAY,
};
const report: SalesReport = {
    ...query,
    timeZone: 'Asia/Manila',
    accountingBasis: 'EVENT_DATE',
    costBasis: 'LATEST_RECEIPT',
    generatedAt: '2026-11-01T00:00Z',
    totals: emptyMetrics(),
    rows: [],
    reconciliation: {
        lateOfflineTransactions: 0,
        lateOfflineNetSales: 0,
        priorPeriodReversals: 0,
        priorPeriodReversalAmount: 0,
        chargedSales: 0,
        reversalAmount: 0,
        note: 'Immutable Z-read',
    },
};

describe('report delivery', () => {
    it('returns actual store-day settings and streams validated report CSV headers/body', async () => {
        const service = new ReportsService(
            {} as Model<Sales>,
            settingsMock({
                timezone: 'Pacific/Auckland',
            }) as unknown as SettingsService,
        );
        const call = jest
            .spyOn(service, 'salesReport')
            .mockResolvedValue(report);
        const controller = new ReportsController(service);
        expect(await controller.options()).toMatchObject({
            timeZone: 'Pacific/Auckland',
            maxDays: 366,
        });
        expect((await controller.options()).today).toMatch(
            /^\d{4}-\d{2}-\d{2}$/,
        );
        expect(await controller.sales(query)).toBe(report);
        const stream = await controller.csv(query);
        expect(stream.getHeaders()).toMatchObject({
            type: 'text/csv; charset=utf-8',
            disposition:
                'attachment; filename="sales-2026-11-01-2026-11-01-day.csv"',
        });
        let text = '';
        for await (const part of stream.getStream()) {
            text += String(part);
        }
        expect(text.startsWith('\ufeff')).toBe(true);
        expect(text).toContain('TOTAL');
        expect(call).toHaveBeenCalledWith(query);
    });
    it('propagates pre-stream errors instead of returning partial successful CSV', async () => {
        const service = new ReportsService(
            {} as Model<Sales>,
            settingsMock() as unknown as SettingsService,
        );
        jest.spyOn(service, 'salesReport').mockRejectedValue(
            new Error('invalid source'),
        );
        await expect(new ReportsController(service).csv(query)).rejects.toThrow(
            'invalid source',
        );
    });
    it('always closes the bounded aggregate cursor after success or invalid source failure', async () => {
        const close = jest.fn().mockResolvedValue(undefined);
        const cursor = {
            close,
            async *[Symbol.asyncIterator]() {
                yield* [];
            },
        };
        const setCursor = jest.fn(() => cursor);
        const option = jest.fn(() => ({ cursor: setCursor }));
        const allowDiskUse = jest.fn(() => ({ option }));
        const aggregate = jest.fn(() => ({ allowDiskUse }));
        const service = new ReportsService(
            { aggregate } as unknown as Model<Sales>,
            settingsMock() as unknown as SettingsService,
        );
        expect((await service.salesReport(query)).totals.netSales).toBe(0);
        expect(close).toHaveBeenCalledTimes(1);
        expect(option).toHaveBeenCalledWith({ maxTimeMS: 30000 });
        expect(setCursor).toHaveBeenCalledWith({ batchSize: 200 });
        const throwing = {
            close,
            async *[Symbol.asyncIterator]() {
                yield await Promise.reject(new Error('network failure'));
            },
        };
        setCursor.mockReturnValue(throwing);
        await expect(service.salesReport(query)).rejects.toThrow(
            'network failure',
        );
        expect(close).toHaveBeenCalledTimes(2);
    });
});
it('reads one current database timezone for each report and its metadata', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const cursor = {
        close,
        async *[Symbol.asyncIterator]() {
            yield* [];
        },
    };
    const option = jest.fn(() => ({ cursor: () => cursor }));
    const aggregate = jest.fn(() => ({ allowDiskUse: () => ({ option }) }));
    const service = new ReportsService(
        { aggregate } as unknown as Model<Sales>,
        settingsMock() as unknown as SettingsService,
    );
    const timezone = jest.fn().mockResolvedValue('America/Los_Angeles');
    Reflect.set(service, 'settings', { timezone });
    expect((await service.options()).timeZone).toBe('America/Los_Angeles');
    expect((await service.salesReport(query)).timeZone).toBe(
        'America/Los_Angeles',
    );
    expect(timezone).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalled();
});
