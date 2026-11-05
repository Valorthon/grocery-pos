import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import {
    SalesReportGroup,
    type SalesReport,
    UnitOfMeasure,
} from '@grocery-pos/contracts';
import { click, flush, type } from '@/testing/form-dom';
import type { ApiGet } from '@/testing/api-mock';
import Index from './Index.vue';
const api = vi.hoisted(() => ({ get: vi.fn<ApiGet>() }));
vi.mock('@/axios', () => ({ default: api }));
let app: App | null = null;
const metrics = {
    transactions: 1,
    reversalTransactions: 0,
    grossSales: 8100,
    discounts: 100,
    voids: 0,
    refunds: 0,
    netSales: 8000,
    knownCogs: 4500,
    knownNetSales: 8000,
    knownGrossMargin: 3500,
    grossMargin: 3500,
    knownCostLines: 1,
    unknownCostLines: 0,
    costCoverageComplete: true,
    quantities: [{ unit: UnitOfMeasure.KG, sold: 450, reversed: 0, net: 450 }],
};
function response(overrides: Partial<SalesReport> = {}): SalesReport {
    return {
        from: '2026-11-05',
        to: '2026-11-05',
        timeZone: 'Pacific/Auckland',
        groupBy: SalesReportGroup.DAY,
        accountingBasis: 'EVENT_DATE',
        costBasis: 'LATEST_RECEIPT',
        generatedAt: '2026-11-05T00:00Z',
        rows: [{ ...metrics, key: '2026-11-05', label: '2026-11-05' }],
        totals: { ...metrics },
        reconciliation: {
            lateOfflineTransactions: 0,
            lateOfflineNetSales: 0,
            priorPeriodReversals: 0,
            priorPeriodReversalAmount: 0,
            chargedSales: 8000,
            reversalAmount: 0,
            note: 'Original shift Z-reads remain immutable.',
        },
        ...overrides,
    };
}
async function mount() {
    setActivePinia(createPinia());
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            {
                path: '/shifts',
                name: 'Shifts',
                component: { template: '<div />' },
            },
        ],
    });
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(Index);
    app.use(router);
    app.mount(host);
    await flush();
}
function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
beforeEach(() => {
    api.get.mockImplementation(async (url) => {
        if (url === '/reports/options')
            return {
                data: {
                    timeZone: 'Pacific/Auckland',
                    today: '2026-11-05',
                    maxDays: 366,
                },
            };
        if (url === '/reports/sales') return { data: response() };
        if (url === '/reports/sales.csv')
            return { data: new Blob(['\ufeffsafe,csv']) };
        if (url === '/categories')
            return {
                data: {
                    data: [{ _id: 'cat', name: 'Frozen', isActive: false }],
                    totalItems: 1,
                },
            };
        return {
            data: { data: [{ _id: 'user', name: 'Cashier' }], totalItems: 1 },
        };
    });
    vi.stubGlobal(
        'URL',
        Object.assign(URL, {
            createObjectURL: vi.fn(() => 'blob:csv'),
            revokeObjectURL: vi.fn(),
        }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
});

describe('event-date reports UI', () => {
    it('uses server timezone date, shows weighted quantity, margin and reconciliation', async () => {
        await mount();
        expect(api.get).toHaveBeenCalledWith('/reports/sales', {
            params: { from: '2026-11-05', to: '2026-11-05', groupBy: 'day' },
        });
        expect(document.body.textContent).toContain('Pacific/Auckland');
        expect(document.body.textContent).toContain('0.450 kg');
        expect(document.body.textContent).toContain('₱35.00');
        expect(
            document.querySelector('svg[aria-label="Daily net sales trend"]'),
        ).not.toBeNull();
        expect(document.body.textContent).toContain(
            'Original shift Z-reads remain immutable',
        );
        expect(document.body.textContent).toContain('Frozen (archived)');
    });
    it('shows incomplete coverage instead of false complete gross margin', async () => {
        const original = api.get.getMockImplementation()!;
        api.get.mockImplementation((url, config) =>
            url === '/reports/sales'
                ? Promise.resolve({
                      data: response({
                          totals: {
                              ...metrics,
                              grossMargin: null,
                              unknownCostLines: 2,
                              costCoverageComplete: false,
                          },
                      }),
                  })
                : original(url, config),
        );
        await mount();
        expect(document.body.textContent).toContain('Incomplete cost coverage');
        expect(document.body.textContent).toContain(
            'Missing costs are not zero',
        );
    });
    it('validates reversed, missing and oversized ranges without requests', async () => {
        await mount();
        const count = api.get.mock.calls.filter(
            ([url]) => url === '/reports/sales',
        ).length;
        await type('From', '2027-01-01');
        await type('To (inclusive)', '2026-01-01');
        await click('Run report');
        expect(document.body.textContent).toContain(
            'Choose a valid inclusive range',
        );
        await type('From', '2024-01-01');
        await type('To (inclusive)', '2026-01-01');
        await click('Run report');
        await type('From', '');
        await click('Run report');
        expect(
            api.get.mock.calls.filter(([url]) => url === '/reports/sales'),
        ).toHaveLength(count);
    });
    it('presets come from store day and custom edits do not alter applied CSV filters', async () => {
        await mount();
        const preset =
            document.querySelector<HTMLSelectElement>('#report-preset')!;
        preset.value = 'This month';
        preset.dispatchEvent(new Event('change'));
        await flush();
        await click('Run report');
        expect(api.get).toHaveBeenCalledWith('/reports/sales', {
            params: { from: '2026-11-01', to: '2026-11-05', groupBy: 'day' },
        });
        await type('From', '2026-01-01');
        await click('Export CSV');
        expect(api.get).toHaveBeenCalledWith('/reports/sales.csv', {
            params: { from: '2026-11-01', to: '2026-11-05', groupBy: 'day' },
            responseType: 'blob',
        });
        expect(URL.createObjectURL).toHaveBeenCalledOnce();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:csv');
    });
    it('shows settings failures and retries initialization', async () => {
        const original = api.get.getMockImplementation()!;
        api.get.mockImplementationOnce(() =>
            Promise.reject(new Error('offline')),
        );
        await mount();
        // Category/user lookups mount before the component settings hook; select the endpoint explicitly.
        api.get.mockImplementation((url, config) =>
            url === '/reports/options'
                ? Promise.reject(new Error('offline'))
                : original(url, config),
        );
        app?.unmount();
        app = null;
        document.body.innerHTML = '';
        await mount();
        expect(document.body.textContent).toContain(
            'Could not load report settings',
        );
        api.get.mockImplementation(original);
        await click('Retry report');
        expect(
            document.querySelector('[data-testid="report-applied"]'),
        ).not.toBeNull();
    });
    it('shows report failures while keeping an existing applied report', async () => {
        await mount();
        const original = api.get.getMockImplementation()!;
        api.get.mockImplementation((url, config) =>
            url === '/reports/sales'
                ? Promise.reject(new Error('offline'))
                : original(url, config),
        );
        await click('Run report');
        expect(document.body.textContent).toContain(
            'Could not load sales report',
        );
        expect(
            document.querySelector('[data-testid="report-applied"]'),
        ).not.toBeNull();
        api.get.mockImplementation(original);
        await click('Retry report');
        expect(document.querySelector('[role="alert"]')).toBeNull();
    });
    it('retries the failed query rather than the last success or unapplied edits', async () => {
        await mount();
        const original = api.get.getMockImplementation()!;
        const failed = deferred<{ data: SalesReport }>();
        const retried = deferred<{ data: SalesReport }>();
        api.get.mockImplementation((url, config) =>
            url === '/reports/sales' ? failed.promise : original(url, config),
        );
        await type('From', '2026-11-01');
        for (const [id, value] of [
            ['report-group', 'product'],
            ['report-cashier', 'user'],
            ['report-category', 'cat'],
            ['report-payment', 'CASH'],
        ]) {
            const select = document.querySelector<HTMLSelectElement>(`#${id}`)!;
            select.value = value;
            select.dispatchEvent(new Event('change'));
            await flush();
        }
        const query = {
            from: '2026-11-01',
            to: '2026-11-05',
            groupBy: 'product',
            cashier: 'user',
            category: 'cat',
            paymentType: 'CASH',
        };
        await click('Run report');
        failed.reject(new Error('offline'));
        await flush();
        expect(document.body.textContent).toContain(
            'Could not load sales report',
        );
        expect(
            document.querySelector('[data-testid="report-applied"]')
                ?.textContent,
        ).toContain('2026-11-05 through 2026-11-05');
        await click('Export CSV');
        expect(api.get).toHaveBeenLastCalledWith('/reports/sales.csv', {
            params: { from: '2026-11-05', to: '2026-11-05', groupBy: 'day' },
            responseType: 'blob',
        });
        await type('From', '2026-10-01');
        api.get.mockImplementation((url, config) =>
            url === '/reports/sales' ? retried.promise : original(url, config),
        );
        await click('Retry report');
        expect(api.get).toHaveBeenLastCalledWith('/reports/sales', {
            params: query,
        });
        retried.resolve({
            data: response({
                from: query.from,
                groupBy: SalesReportGroup.PRODUCT,
            }),
        });
        await flush();
        expect(document.body.textContent).not.toContain(
            'Could not load sales report',
        );
        expect(
            document.querySelector('[data-testid="report-applied"]')
                ?.textContent,
        ).toContain('2026-11-01 through 2026-11-05');
        await click('Export CSV');
        expect(api.get).toHaveBeenLastCalledWith('/reports/sales.csv', {
            params: query,
            responseType: 'blob',
        });
    });
    it('keeps errors visible when CSV export fails', async () => {
        await mount();
        const original = api.get.getMockImplementation()!;
        api.get.mockImplementation((url, config) =>
            url.endsWith('.csv')
                ? Promise.reject(new Error('offline'))
                : original(url, config),
        );
        await click('Export CSV');
        expect(document.body.textContent).toContain(
            'Could not export sales report',
        );
    });
    it('does not apply report/options replies after unmount', async () => {
        const pending = deferred<{ data: SalesReport }>();
        const original = api.get.getMockImplementation()!;
        api.get.mockImplementation((url, config) =>
            url === '/reports/sales' ? pending.promise : original(url, config),
        );
        await mount();
        app?.unmount();
        app = null;
        document.body.innerHTML = '';
        pending.resolve({ data: response() });
        await flush();
        expect(document.body.textContent).toBe('');
    });
    it('shows an empty report without a fabricated chart', async () => {
        const original = api.get.getMockImplementation()!;
        api.get.mockImplementation((url, config) =>
            url === '/reports/sales'
                ? Promise.resolve({ data: response({ rows: [] }) })
                : original(url, config),
        );
        await mount();
        expect(document.body.textContent).toContain(
            'No matching sales or reversal events',
        );
        expect(document.querySelector('svg')).toBeNull();
    });
});
