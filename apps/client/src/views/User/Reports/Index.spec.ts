import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import {
    SalesReportGroup,
    type SalesReport,
    UnitOfMeasure,
} from '@grocery-pos/contracts';
import {
    click,
    flush,
    openDates,
    openMoreFilters,
    type,
    headerText,
} from '@/testing/form-dom';
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
        // Human labels, same values (#143).
        expect(
            [
                ...document.querySelectorAll<HTMLOptionElement>(
                    '#report-group option',
                ),
            ].map((o) => [o.textContent?.trim(), o.value]),
        ).toEqual([
            ['Group by day', 'day'],
            ['Group by product', 'product'],
            ['Group by category', 'category'],
            ['Group by cashier', 'cashier'],
            ['Group by payment type', 'paymentType'],
        ]);
        expect(
            document.querySelector('[data-testid="report-applied"]')
                ?.textContent,
        ).toContain('· Day ·');
        expect(document.body.textContent).toContain('0.450 kg');
        expect(document.body.textContent).toContain('₱35.00');
        expect(
            document.querySelector('svg[aria-label="Daily net sales trend"]'),
        ).not.toBeNull();
        await openMoreFilters();
        expect(document.body.textContent).toContain('Frozen (archived)');
    });
    it('shows reconciliation figures as tiles, a closed explanation and a Shifts link (#216)', async () => {
        const original = api.get.getMockImplementation()!;
        api.get.mockImplementation((url, config) =>
            url === '/reports/sales'
                ? Promise.resolve({
                      data: response({
                          reconciliation: {
                              chargedSales: 8000,
                              reversalAmount: -1200,
                              priorPeriodReversals: 2,
                              priorPeriodReversalAmount: -700,
                              lateOfflineTransactions: 1,
                              lateOfflineNetSales: 450,
                              note: 'server note',
                          },
                      }),
                  })
                : original(url, config),
        );
        await mount();
        const tile = (key: string) =>
            document.querySelector(`[data-reconcile="${key}"]`)?.textContent;
        expect(tile('charged')).toContain('Original charged sales');
        expect(tile('charged')).toContain('₱80.00');
        expect(tile('reversals')).toContain('₱12.00');
        expect(tile('prior')).toContain('Prior-period reversals');
        expect(tile('prior')).toContain('₱7.00');
        expect(tile('prior')).toContain('2 reversals');
        expect(tile('late')).toContain('Late offline occurrences');
        expect(tile('late')).toContain('₱4.50');
        expect(tile('late')).toContain(
            '1 sale uploaded after its shift closed',
        );
        const notes = document.querySelector<HTMLDetailsElement>(
            '[data-testid="reconciliation-notes"]',
        )!;
        expect(notes.open).toBe(false);
        expect(notes.querySelector('summary')?.textContent?.trim()).toBe(
            'How these numbers work',
        );
        const bullets = [...notes.querySelectorAll('li')].map((li) =>
            li.textContent?.trim(),
        );
        expect(bullets).toHaveLength(7);
        expect(bullets.join(' ')).toBe(
            'Sales use their original occurrence date; reversals use the date they happened. Gross sales less discounts equals original charged sales. Net sales then subtracts reversal events. Original shift Z-reads are immutable closing snapshots: compare original charges, drawer payout movements, and separate late-offline addenda, not an unadjusted calendar-period net. Category/product groups count a transaction in each group it touches; totals count it once. Categories use current product assignments. SPLIT is one payment-type group. Product costs use the latest-receipt estimate; unknown cost coverage is explicit.',
        );
        const link = document.querySelector<HTMLAnchorElement>(
            '[data-testid="reconciliation-shifts"]',
        )!;
        expect(link.getAttribute('href')).toBe('/shifts');
        expect(link.className).toContain('min-h-11');
        expect(link.textContent).toContain(
            'Review original Z-reads and late addenda',
        );
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
        await openDates();
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
        await openDates();
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
    it('a preset applies at once with one request; other changes wait for Run report (#215)', async () => {
        await mount();
        await openDates();
        const sales = () =>
            api.get.mock.calls.filter(([url]) => url === '/reports/sales');
        const before = sales().length;
        const preset =
            document.querySelector<HTMLSelectElement>('#report-preset')!;
        preset.value = 'Last week';
        preset.dispatchEvent(new Event('change'));
        await flush();
        expect(sales()).toHaveLength(before + 1);
        expect(sales()[sales().length - 1]?.[1]).toEqual({
            params: { from: '2026-10-26', to: '2026-11-01', groupBy: 'day' },
        });

        const group =
            document.querySelector<HTMLSelectElement>('#report-group')!;
        group.value = SalesReportGroup.PRODUCT;
        group.dispatchEvent(new Event('change'));
        await type('From', '2026-10-20');
        await flush();
        expect(preset.value).toBe('Custom');
        preset.value = 'Custom';
        preset.dispatchEvent(new Event('change'));
        await flush();
        expect(sales()).toHaveLength(before + 1);
        await click('Run report');
        expect(sales()).toHaveLength(before + 2);
    });
    it('Clear resets to Today with the default grouping, enabled only off the defaults (#215)', async () => {
        await mount();
        await openDates();
        const clear = () =>
            [...document.querySelectorAll('button')].find((b) =>
                b.textContent?.includes('Clear Filters'),
            )!;
        expect(clear().disabled).toBe(true);
        const group =
            document.querySelector<HTMLSelectElement>('#report-group')!;
        group.value = SalesReportGroup.PRODUCT;
        group.dispatchEvent(new Event('change'));
        await type('From', '2026-11-01');
        await flush();
        expect(clear().disabled).toBe(false);
        const sales = () =>
            api.get.mock.calls.filter(([url]) => url === '/reports/sales');
        const before = sales().length;

        await click('Clear Filters');

        expect(sales()).toHaveLength(before + 1);
        expect(sales()[sales().length - 1]?.[1]).toEqual({
            params: { from: '2026-11-05', to: '2026-11-05', groupBy: 'day' },
        });
        expect(
            document.querySelector<HTMLSelectElement>('#report-preset')!.value,
        ).toBe('Today');
        expect(group.value).toBe(SalesReportGroup.DAY);
        expect(clear().disabled).toBe(true);
    });
    it('Run report then Clear end the one filter row at field height (#215, #254)', async () => {
        await mount();
        const run = [...document.querySelectorAll('button')].find((b) =>
            b.textContent?.includes('Run report'),
        )!;
        const clear = [...document.querySelectorAll('button')].find((b) =>
            b.textContent?.includes('Clear Filters'),
        )!;
        const row = document.querySelector('[data-filter-row]')!;
        expect(run.parentElement).toBe(row);
        expect(clear.parentElement).toBe(row);
        expect(row.lastElementChild).toBe(clear);
        expect(clear.previousElementSibling).toBe(run);
        expect(run.classList).toContain('min-h-11');
        // No labels above the row's fields; aria-labels name them.
        expect(row.querySelector('label')).toBeNull();
        expect(
            document.querySelector('#report-group')!.getAttribute('aria-label'),
        ).toBe('Group by');
    });
    it('Filters dialog changes wait for Run report and its count shows applied filters only (#254)', async () => {
        await mount();
        const sales = () =>
            api.get.mock.calls.filter(([url]) => url === '/reports/sales');
        const before = sales().length;
        const more = () =>
            document.querySelector('[data-more-filters]')!.textContent?.trim();
        expect(more()).toBe('Filters');
        await openMoreFilters();
        const cashier =
            document.querySelector<HTMLSelectElement>('#report-cashier')!;
        cashier.value = 'user';
        cashier.dispatchEvent(new Event('change'));
        await flush();
        expect(sales()).toHaveLength(before);
        expect(more()).toBe('Filters');
        await click('Run report');
        expect(sales()).toHaveLength(before + 1);
        expect(sales()[sales().length - 1]?.[1]).toEqual({
            params: {
                from: '2026-11-05',
                to: '2026-11-05',
                groupBy: 'day',
                cashier: 'user',
            },
        });
        expect(more()).toBe('Filters · 1');
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
        await openDates();
        await openMoreFilters();
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
        expect(
            document.querySelector('svg[aria-label="Daily net sales trend"]'),
        ).toBeNull();
        expect(
            document.querySelector('[data-testid="report-totals"]'),
        ).toBeNull();
    });
    it('right-aligns every numeric column with tabular figures (#170)', async () => {
        await mount();
        const heads = [...document.querySelectorAll('thead th')];
        expect(heads.map((th) => headerText(th))).toEqual([
            'Group',
            'Sales / reversals',
            'Quantity (net)',
            'Gross',
            'Discounts',
            'Voids',
            'Refunds',
            'Net',
            'Known COGS',
            'Margin estimate',
        ]);
        expect(heads[0].className).not.toContain('num');
        for (const th of heads.slice(1)) {
            expect(th.className).toContain('text-right');
            expect(th.className).toContain('num');
        }
        const label = document.querySelector('tbody tr:first-child th');
        expect(label?.getAttribute('scope')).toBe('row');
        expect(
            document.querySelector('table > caption')?.textContent,
        ).toContain('totals count it once');
        const cells = [...document.querySelectorAll('tbody tr:first-child td')];
        expect(cells).toHaveLength(9);
        for (const td of cells)
            expect(td.className).toContain('text-right num');
        const totals = document.querySelector(
            'tfoot [data-testid="report-totals"]',
        );
        expect(totals?.textContent).toContain('Total');
        const totalCells = [...totals!.querySelectorAll('td')];
        expect(totalCells).toHaveLength(9);
        for (const td of totalCells)
            expect(td.className).toContain('text-right num');
    });
});
