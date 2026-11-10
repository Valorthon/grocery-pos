import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import {
    PaymentType,
    Role,
    SaleStatus,
    ShiftStatus,
    TenderType,
} from '@grocery-pos/contracts';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { useAuthStore } from '@/stores/auth';
import Index from './Index.vue';
import type { ApiGet, ApiSend } from '@/testing/api-mock';

const api = vi.hoisted(() => ({
    get: vi.fn<ApiGet>(),
    post: vi.fn<ApiSend>(),
}));
vi.mock('@/axios', () => ({ default: api }));
const routeState = vi.hoisted(() => ({
    name: 'SalesHistory',
    meta: { title: 'Sales history' },
    query: {},
}));
const routerQuery = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('vue-router', () => ({
    useRouter: () => ({
        push: vi.fn(),
        currentRoute: { value: { query: routerQuery.value } },
    }),
    useRoute: () => routeState,
}));

const OWN_SHIFT = 'shift-own';
const OTHER_SHIFT = 'shift-other';

function openShift(_id: string, cashierName: string) {
    return {
        _id,
        status: ShiftStatus.OPEN,
        cashierName,
        terminal: 'Lane #1',
        openedAt: '2026-09-25T00:00:00.000Z',
        closedAt: null,
        openingFloat: 100_000,
        report: null,
    };
}

/** A ₱800 cash sale paid with ₱1,000: ₱800 net cash to pay back. */
const CASH_SALE = {
    _id: 'sale1',
    cashier: { name: 'ana' },
    amount: 80_000,
    paymentType: PaymentType.CASH,
    tenders: [{ type: TenderType.CASH, amount: 100_000 }],
    changeGiven: 20_000,
    status: SaleStatus.COMPLETED,
    createdAt: '2026-09-25T01:00:00.000Z',
    shift: OWN_SHIFT,
};

let app: App | null = null;
let pinia: Pinia;

function serve(sale: object, open: object[]) {
    api.get.mockImplementation((url: string) => {
        if (url === '/sales') {
            return Promise.resolve({ data: { data: [sale], totalItems: 1 } });
        }
        if (url === '/users' || url === '/categories')
            return Promise.resolve({ data: { data: [], totalItems: 0 } });
        if (url === '/shifts') {
            return Promise.resolve({
                data: { data: open, totalItems: open.length },
            });
        }
        return Promise.resolve({ data: [] });
    });
}

async function flush() {
    for (let i = 0; i < 5; i++) await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 5; i++) await nextTick();
}

async function startVoid() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Index);
    app.use(pinia);
    app.mount(host);
    await flush();

    document.querySelector<HTMLElement>('tbody tr.cursor-pointer')!.click();
    await flush();
    const voidButton = [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Void sale',
    )!;
    voidButton.click();
    await flush();

    const reason =
        document.querySelector<HTMLInputElement>('#reversal-reason')!;
    reason.value = 'mis-ring';
    reason.dispatchEvent(new Event('input'));
    await flush();
}

function confirmButton() {
    return [...document.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Confirm void'),
    )!;
}

async function approveManager() {
    const name = document.querySelector<HTMLInputElement>(
        '#override-manager-name',
    )!;
    name.value = 'boss';
    name.dispatchEvent(new Event('input'));
    const pin = document.querySelector<HTMLInputElement>(
        '#override-manager-pin',
    )!;
    pin.value = '012345';
    pin.dispatchEvent(new Event('input'));
    await flush();
    [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.trim() === 'Approve action')!
        .click();
    await flush();
}

beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    api.get.mockReset();
    api.post.mockReset().mockResolvedValue({ data: { token: 'approved' } });
    useAuthStore().user = { username: 'boss', roles: [Role.Admin] };
});

afterEach(() => {
    routerQuery.value = {};
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

describe('admin void/refund cash payout (issue #2)', () => {
    it('pays back from the sale’s own shift while it is open, without asking', async () => {
        serve(CASH_SALE, [openShift(OWN_SHIFT, 'ana')]);
        await startVoid();

        expect(
            document.querySelector('[data-testid="payout-own-shift"]')
                ?.textContent,
        ).toContain('800.00');
        expect(
            document.querySelector('[data-testid="payout-shift"]'),
        ).toBeNull();

        confirmButton().click();
        await flush();
        await approveManager();

        expect(api.post).toHaveBeenCalledWith(
            '/sales/sale1/void',
            {
                reason: 'mis-ring',
            },
            { headers: { 'X-Manager-Approval': 'approved' } },
        );
    });

    it('makes the admin choose an open shift when the sale’s shift is closed', async () => {
        serve(CASH_SALE, [openShift(OTHER_SHIFT, 'ben')]);
        await startVoid();

        const select = document.querySelector<HTMLSelectElement>(
            '[data-testid="payout-shift"] select',
        )!;
        expect(select).not.toBeNull();
        // Nothing is preselected: confirm waits for a choice.
        expect(select.value).toBe('');
        expect(confirmButton().disabled).toBe(true);

        select.value = OTHER_SHIFT;
        select.dispatchEvent(new Event('change'));
        await flush();
        expect(confirmButton().disabled).toBe(false);
        confirmButton().click();
        await flush();
        await approveManager();

        expect(api.post).toHaveBeenCalledWith(
            '/sales/sale1/void',
            {
                reason: 'mis-ring',
                payoutShiftId: OTHER_SHIFT,
            },
            { headers: { 'X-Manager-Approval': 'approved' } },
        );
    });

    it('asks for a shift for a sale from before shifts', async () => {
        serve({ ...CASH_SALE, shift: undefined }, [
            openShift(OTHER_SHIFT, 'ben'),
        ]);
        await startVoid();

        expect(
            document.querySelector('[data-testid="payout-shift"] select'),
        ).not.toBeNull();
    });

    it('blocks the reversal when cash is owed and no shift is open', async () => {
        serve(CASH_SALE, []);
        await startVoid();

        expect(
            document.querySelector('[data-testid="payout-no-open-shift"]'),
        ).not.toBeNull();
        expect(confirmButton().disabled).toBe(true);
    });

    it('says the open shifts could not be loaded, not that none is open', async () => {
        serve(CASH_SALE, [openShift(OTHER_SHIFT, 'ben')]);
        const serveShifts = api.get.getMockImplementation()!;
        api.get.mockImplementation((url, config) =>
            url === '/shifts'
                ? Promise.reject(
                      new AxiosError('Network Error', 'ERR_NETWORK', {
                          headers: new AxiosHeaders(),
                      }),
                  )
                : serveShifts(url, config),
        );
        await startVoid();

        const error = () =>
            document.querySelector('[data-testid="payout-shifts-error"]');
        expect(error()?.textContent).toContain('Could not load open shifts');
        expect(
            document.querySelector('[data-testid="payout-no-open-shift"]'),
        ).toBeNull();

        api.get.mockImplementation(serveShifts);
        [...error()!.querySelectorAll('button')]
            .find((b) => b.textContent?.includes('Retry'))!
            .click();
        await flush();

        expect(error()).toBeNull();
        expect(
            document.querySelector('[data-testid="payout-own-shift"]'),
        ).toBeNull();
        expect(
            document.querySelector('[data-testid="payout-shift"] select'),
        ).not.toBeNull();
    });

    it('asks nothing for a GCash-only sale, which touches no drawer', async () => {
        serve(
            {
                ...CASH_SALE,
                paymentType: PaymentType.GCASH,
                tenders: [{ type: TenderType.GCASH, amount: 80_000 }],
                changeGiven: 0,
                referenceNumber: '1234567890123',
            },
            [],
        );
        await startVoid();

        expect(
            document.querySelector('[data-testid="payout-none"]'),
        ).not.toBeNull();
        expect(api.get).not.toHaveBeenCalledWith('/shifts', expect.anything());

        confirmButton().click();
        await flush();
        await approveManager();
        expect(api.post).toHaveBeenCalledWith(
            '/sales/sale1/void',
            {
                reason: 'mis-ring',
            },
            { headers: { 'X-Manager-Approval': 'approved' } },
        );
    });
});

describe('sales errors (issue #18)', () => {
    const httpError = (status: number, message: string) => {
        const config = { headers: new AxiosHeaders() };
        return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, {
            status,
            statusText: '',
            headers: {},
            config,
            data: { statusCode: status, message },
        } as AxiosResponse);
    };

    async function mount() {
        const host = document.createElement('div');
        document.body.appendChild(host);
        app = createApp(Index);
        app.use(pinia);
        app.mount(host);
        await flush();
        return host;
    }

    it('puts the search and the table in one card, as admin lists do (#208)', async () => {
        serve(CASH_SALE, []);
        await mount();
        const card = document
            .querySelector('form[role="search"]')
            ?.closest('section');
        expect(card).not.toBeNull();
        expect(card!.querySelector('table')).not.toBeNull();
    });

    it('keeps Sale #, Amount and Status at phone width; details show the rest (#210)', async () => {
        serve(CASH_SALE, []);
        await mount();
        const th = (text: string) =>
            [...document.querySelectorAll('thead th')].find((cell) =>
                cell.textContent?.includes(text),
            )!;
        const classes = (el: Element) => el.className.split(/\s+/);
        expect(classes(th('Cashier'))).toEqual(
            expect.arrayContaining(['hidden', 'md:table-cell']),
        );
        expect(classes(th('Payment'))).toEqual(
            expect.arrayContaining(['hidden', 'sm:table-cell']),
        );
        expect(classes(th('Date'))).toEqual(
            expect.arrayContaining(['hidden', 'lg:table-cell']),
        );
        for (const shown of ['Sale #', 'Amount', 'Status'])
            expect(classes(th(shown))).not.toContain('hidden');
        document.querySelector<HTMLElement>('tbody tr.cursor-pointer')!.click();
        await flush();
        expect(
            document.querySelector('[data-testid="sale-detail-cashier"]')
                ?.textContent,
        ).toContain('ana');
        expect(
            document.querySelector('[data-testid="sale-detail-date"]')
                ?.textContent,
        ).toMatch(/Date\s*\S/);
        expect(document.body.textContent).toContain('Payment');
    });

    it('opens Sale Details from a focused row with Enter (#234)', async () => {
        serve(CASH_SALE, []);
        await mount();
        const row = document.querySelector<HTMLElement>(
            'tbody tr.cursor-pointer',
        )!;
        expect(row.tabIndex).toBe(0);
        expect(row.getAttribute('aria-describedby')).toBeTruthy();
        row.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
        await flush();
        expect(
            document.querySelector('[data-testid="sale-detail-cashier"]')
                ?.textContent,
        ).toContain('ana');
    });

    it('badges each status: completed green, voided red, refunded amber (#243)', async () => {
        api.get.mockImplementation((url: string) =>
            Promise.resolve({
                data:
                    url === '/sales'
                        ? {
                              data: [
                                  CASH_SALE,
                                  {
                                      ...CASH_SALE,
                                      _id: 'sale2',
                                      status: SaleStatus.VOIDED,
                                  },
                                  {
                                      ...CASH_SALE,
                                      _id: 'sale3',
                                      status: SaleStatus.REFUNDED,
                                  },
                              ],
                              totalItems: 3,
                          }
                        : { data: [], totalItems: 0 },
            }),
        );
        await mount();
        const badges = [
            ...document.querySelectorAll('[data-testid="sale-status"]'),
        ];
        expect(badges.map((b) => b.textContent?.trim())).toEqual([
            'Completed',
            'Voided',
            'Refunded',
        ]);
        expect(badges.map((b) => b.className)).toEqual([
            expect.stringContaining('bg-success-bg'),
            expect.stringContaining('bg-danger-bg'),
            expect.stringContaining('bg-warning-bg'),
        ]);
        expect(
            document.querySelector('tbody tr[data-row-click]')?.closest('table')
                ?.parentElement?.textContent,
        ).toContain('Press Enter to open the sale details');
    });

    it('opens the deep-linked sale from the dashboard (?saleNumber=&details=1, #243)', async () => {
        const ID = 'ab'.repeat(12);
        routerQuery.value = { saleNumber: ID, details: '1' };
        serve({ ...CASH_SALE, _id: ID }, []);
        await mount();
        expect(api.get).toHaveBeenCalledWith('/sales', {
            params: expect.objectContaining({ saleNumber: ID }) as unknown,
        });
        expect(
            document.querySelector('[data-testid="sale-detail-cashier"]')
                ?.textContent,
        ).toContain('ana');
    });

    it('opens nothing for a deep link without details=1', async () => {
        const ID = 'ab'.repeat(12);
        routerQuery.value = { saleNumber: ID };
        serve({ ...CASH_SALE, _id: ID }, []);
        await mount();
        expect(
            document.querySelector('[data-testid="sale-detail-cashier"]'),
        ).toBeNull();
    });

    it('shows a failed list in the table, then retries it', async () => {
        api.get.mockRejectedValueOnce(httpError(500, 'Internal server error'));
        await mount();

        const error = document.querySelector('[data-testid="table-error"]');
        expect(error?.textContent).toContain('Internal server error');

        serve(CASH_SALE, []);
        [...error!.querySelectorAll('button')]
            .find((b) => b.textContent?.includes('Retry'))!
            .click();
        await flush();

        expect(
            document.querySelector('[data-testid="table-error"]'),
        ).toBeNull();
        expect(document.body.textContent).toContain('ana');
    });

    it('says the sale details failed instead of listing nothing', async () => {
        serve(CASH_SALE, []);
        await mount();
        api.get.mockRejectedValueOnce(httpError(404, 'Sale not found'));

        document.querySelector<HTMLElement>('tbody tr.cursor-pointer')!.click();
        await flush();

        const error = document.querySelector(
            '[data-testid="details-table"] [data-testid="table-error"]',
        );
        expect(error?.getAttribute('role')).toBe('alert');
        expect(error?.textContent).toContain('Sale not found');
        expect(
            document.querySelector('[data-testid="details-total"]')
                ?.textContent,
        ).toContain('Total charged');

        [...error!.querySelectorAll('button')]
            .find((b) => b.textContent?.includes('Retry'))!
            .click();
        await flush();
        expect(api.get).toHaveBeenLastCalledWith('/sales/details/sale1');
        expect(
            document.querySelector(
                '[data-testid="details-table"] [data-testid="table-error"]',
            ),
        ).toBeNull();
    });
});

describe('sale details freshness (issue #20)', () => {
    const SALE_B = { ...CASH_SALE, _id: 'sale2', cashier: { name: 'ben' } };
    const line = (name: string) => [
        { _id: `d-${name}`, product: { name }, quantity: 1, unitPrice: 100 },
    ];

    /** Details requests that answer only when the test says so. */
    function serveDeferredDetails() {
        const pending = new Map<string, (lines: unknown) => void>();
        api.get.mockImplementation((url: string) => {
            if (url === '/sales') {
                return Promise.resolve({
                    data: { data: [CASH_SALE, SALE_B], totalItems: 2 },
                });
            }
            if (url.startsWith('/sales/details/')) {
                return new Promise((resolve) => {
                    pending.set(url.slice('/sales/details/'.length), (data) =>
                        resolve({ data }),
                    );
                });
            }
            return Promise.resolve({ data: { data: [], totalItems: 0 } });
        });
        return pending;
    }

    async function mount() {
        const host = document.createElement('div');
        document.body.appendChild(host);
        app = createApp(Index);
        app.use(pinia);
        app.mount(host);
        await flush();
    }

    async function openRow(index: number) {
        document
            .querySelectorAll<HTMLElement>('tbody tr.cursor-pointer')
            [index]!.click();
        await flush();
    }

    const modalText = () => document.body.textContent ?? '';

    it('never shows the previous sale’s lines while the next one loads', async () => {
        const pending = serveDeferredDetails();
        await mount();

        await openRow(0);
        pending.get('sale1')!(line('apple'));
        await flush();
        expect(modalText()).toContain('apple');

        await openRow(1);

        expect(modalText()).not.toContain('apple');
        pending.get('sale2')!(line('banana'));
        await flush();
        expect(modalText()).toContain('banana');
    });

    it('drops a late answer for a sale clicked earlier', async () => {
        const pending = serveDeferredDetails();
        await mount();

        await openRow(0);
        await openRow(1);
        pending.get('sale2')!(line('banana'));
        await flush();
        pending.get('sale1')!(line('apple'));
        await flush();

        expect(modalText()).toContain('banana');
        expect(modalText()).not.toContain('apple');
        expect(document.querySelector('.animate-spin')).toBeNull();
    });
});

describe('void/refund while reversing (issue #22)', () => {
    it('cannot be dismissed while the reversal is in flight', async () => {
        serve(CASH_SALE, [openShift(OWN_SHIFT, 'ana')]);
        await startVoid();
        let fail!: (e: Error) => void;
        api.post.mockImplementation((url) =>
            url === '/auth/override'
                ? Promise.resolve({ data: { token: 'approved' } })
                : new Promise((_, reject) => (fail = reject)),
        );
        confirmButton().click();
        await flush();

        await approveManager();
        expect(document.querySelector('[data-modal-close]')).toBeNull();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        document
            .querySelector('.fixed.inset-0')!
            .dispatchEvent(new MouseEvent('mousedown'));
        await flush();
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();

        // A refused reversal leaves the dialog open, dismissable again.
        fail(new Error('offline'));
        await flush();
        expect(document.querySelector('[data-modal-close]')).not.toBeNull();
    });
});

describe('sales-history applied filters and receipt identity', () => {
    async function history() {
        const host = document.createElement('div');
        document.body.append(host);
        app = createApp(Index);
        app.use(pinia);
        app.mount(host);
        await flush();
    }
    function input(id: string, value: string, event = 'input') {
        const field = document.querySelector<HTMLInputElement>(`#${id}`)!;
        field.value = value;
        if (event === 'change') field.dispatchEvent(new Event('input'));
        field.dispatchEvent(new Event(event));
    }
    function button(text: string) {
        return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
            (b) => b.textContent?.trim() === text,
        )!;
    }
    function salesParams() {
        const calls = api.get.mock.calls.filter(([url]) => url === '/sales');
        return calls[calls.length - 1]?.[1]?.params;
    }
    it('searches suffix/full IDs, shows short number and full ID in details', async () => {
        serve({ ...CASH_SALE, _id: '0123456789abcdefdeadbeef' }, []);
        await history();
        // Upper case, as on the receipt (#143).
        expect(document.body.textContent).toContain('DEADBEEF');
        expect(document.body.textContent).not.toContain('deadbeef');
        input('sales-number', 'deadbeef');
        await flush();
        button('Search').click();
        await flush();
        expect(salesParams()).toMatchObject({ saleNumber: 'deadbeef' });
        document.querySelector<HTMLElement>('tbody tr.cursor-pointer')!.click();
        await flush();
        expect(
            document.querySelector('[data-testid="sale-number"]')?.textContent,
        ).toContain('#DEADBEEF');
        expect(
            document.querySelector('[data-testid="sale-full-id"]')?.textContent,
        ).toContain('deadbeef');
    });
    it('rejects malformed identity/date filters without replacing the current result', async () => {
        serve(CASH_SALE, []);
        await history();
        const count = api.get.mock.calls.filter(
            ([url]) => url === '/sales',
        ).length;
        input('sales-number', '.*');
        await flush();
        button('Search').click();
        await flush();
        expect(document.body.textContent).toContain('final eight hexadecimal');
        input('sales-number', '');
        input('sales-from', '2026-11-02');
        input('sales-to', '2026-11-01');
        await flush();
        button('Search').click();
        await flush();
        expect(document.body.textContent).toContain(
            'The end date is before the start date',
        );
        expect(
            api.get.mock.calls.filter(([url]) => url === '/sales'),
        ).toHaveLength(count);
    });
    it('keeps unapplied text out of paging, applies dates/payment and clears all filters', async () => {
        serve(CASH_SALE, []);
        await history();
        input('sales-number', 'deadbeef');
        await flush();
        expect(salesParams()).not.toHaveProperty('saleNumber');
        input('sales-from', '2026-11-01', 'change');
        await flush();
        expect(salesParams()).toMatchObject({
            dateFrom: '2026-11-01',
            saleNumber: 'deadbeef',
        });
        const payment =
            document.querySelector<HTMLSelectElement>('#sales-payment')!;
        payment.value = PaymentType.CASH;
        payment.dispatchEvent(new Event('change'));
        await flush();
        expect(salesParams()).toMatchObject({ paymentType: 'CASH' });
        button('Clear Filters').click();
        await flush();
        expect(salesParams()).toEqual({ page: 1, limit: 5 });
    });
    it('a date preset loads page 1 once with the server today; an edit makes it Custom; Clear resets it (#215)', async () => {
        serve(CASH_SALE, []);
        const original = api.get.getMockImplementation()!;
        api.get.mockImplementation((url, config) =>
            url === '/settings/today'
                ? Promise.resolve({
                      data: { today: '2026-11-10', timezone: 'Asia/Manila' },
                  })
                : original(url, config),
        );
        await history();
        expect(document.querySelector('[data-chip]')).toBeNull();
        expect(button('Filters')).toBeUndefined();
        expect(button('Clear Filters')?.disabled).toBe(true);
        const count = () =>
            api.get.mock.calls.filter(([url]) => url === '/sales').length;
        const before = count();
        const preset =
            document.querySelector<HTMLSelectElement>('#sales-preset')!;

        preset.value = 'Today';
        preset.dispatchEvent(new Event('change'));
        await flush();

        expect(count()).toBe(before + 1);
        expect(salesParams()).toEqual({
            page: 1,
            limit: 5,
            dateFrom: '2026-11-10',
            dateTo: '2026-11-10',
        });
        expect(button('Clear Filters')?.disabled).toBe(false);

        input('sales-from', '2026-11-01', 'change');
        await flush();
        expect(preset.value).toBe('Custom');
        expect(salesParams()).toMatchObject({ dateFrom: '2026-11-01' });

        button('Clear Filters')!.click();
        await flush();
        expect(salesParams()).toEqual({ page: 1, limit: 5 });
        expect(preset.value).not.toBe('Custom');
        expect(button('Clear Filters')?.disabled).toBe(true);
    });
    it('uses managed cashier/category selectors for administrators', async () => {
        serve(CASH_SALE, []);
        const original = api.get.getMockImplementation()!;
        api.get.mockImplementation((url, config) =>
            url === '/categories'
                ? Promise.resolve({
                      data: {
                          data: [
                              { _id: 'cat', name: 'Archived', isActive: false },
                          ],
                          totalItems: 1,
                      },
                  })
                : url === '/users'
                  ? Promise.resolve({
                        data: {
                            data: [{ _id: 'user', name: 'ana' }],
                            totalItems: 1,
                        },
                    })
                  : original(url, config),
        );
        await history();
        const category =
            document.querySelector<HTMLSelectElement>('#sales-category')!;
        expect(category.textContent).toContain('Archived (archived)');
        category.value = 'cat';
        category.dispatchEvent(new Event('change'));
        await flush();
        expect(salesParams()).toMatchObject({ category: 'cat' });
        const cashier =
            document.querySelector<HTMLSelectElement>('#sales-cashier')!;
        cashier.value = 'user';
        cashier.dispatchEvent(new Event('change'));
        await flush();
        expect(salesParams()).toMatchObject({
            cashier: 'user',
            category: 'cat',
        });
    });
});

describe('page frame per layout (#159)', () => {
    afterEach(() => {
        routeState.name = 'SalesHistory';
    });

    async function rootClasses(name: string) {
        routeState.name = name;
        serve(CASH_SALE, []);
        const host = document.createElement('div');
        document.body.appendChild(host);
        app = createApp(Index);
        app.use(pinia);
        app.mount(host);
        await flush();
        expect(host.querySelectorAll('h1')).toHaveLength(1);
        return (host.firstElementChild as HTMLElement).classList;
    }

    it('scrolls itself in the seller layout, whose main does not scroll', async () => {
        const classes = await rootClasses('Sales');
        expect(classes).toContain('overflow-y-auto');
        expect(classes).toContain('min-h-0');
    });

    it('leaves scrolling to the admin layout main', async () => {
        const classes = await rootClasses('SalesHistory');
        expect(classes).not.toContain('overflow-y-auto');
    });
});

describe('sale details receipt (#218)', () => {
    async function openSale(sale: object, open: object[] = []) {
        serve(sale, open);
        await mountAndOpen();
    }
    async function mountAndOpen() {
        const host = document.createElement('div');
        document.body.appendChild(host);
        app = createApp(Index);
        app.use(pinia);
        app.mount(host);
        await flush();
        document.querySelector<HTMLElement>('tbody tr.cursor-pointer')!.click();
        await flush();
    }
    const byTestId = (id: string) =>
        document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const button = (text: string) =>
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(
            (b) => b.textContent?.trim() === text,
        );

    const APPROVED = {
        ...CASH_SALE,
        discount: {
            type: 'FIXED',
            value: 5_000,
            reason: 'loyal customer',
            amount: 5_000,
            approvedBy: 'u-boss',
            approvedByName: 'maria',
        },
        status: SaleStatus.REFUNDED,
        reversal: {
            type: 'REFUND',
            reason: 'returned',
            approvedBy: 'u-sup',
            approvedByName: 'sam',
            at: '2026-09-25T02:00:00.000Z',
            payoutShift: '0123456789abcdef12345678',
            payoutAmount: 75_000,
        },
    };

    it('always shows the full ID, with an icon-only Copy (#236)', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        });
        await openSale({ ...CASH_SALE, _id: '0123456789abcdefdeadbeef' });

        expect(byTestId('sale-number')?.textContent).toBe('#DEADBEEF');
        expect(byTestId('sale-full-id')?.textContent).toBe(
            '0123456789abcdefdeadbeef',
        );
        expect(byTestId('sale-full-id')?.className).toContain('text-xs');
        expect(byTestId('sale-id-toggle')).toBeNull();
        const copy = byTestId('sale-id-copy')!;
        expect(copy.getAttribute('aria-label')).toBe('Copy full ID');
        expect(copy.textContent?.trim()).toBe('');
        expect(copy.className).toContain('w-11');
        expect(copy.className).toContain('h-11');
        copy.click();
        await flush();
        expect(writeText).toHaveBeenCalledWith('0123456789abcdefdeadbeef');
    });

    it('puts total and status on one row and Date, Cashier, Sale in a grid (#236)', async () => {
        await openSale(CASH_SALE);
        const row = byTestId('sale-total-row')!;
        expect(row.className).toContain('justify-between');
        expect(row.contains(byTestId('sale-total'))).toBe(true);
        expect(byTestId('sale-total')?.className).toContain('text-2xl');
        const labels = [
            ...byTestId('sale-detail-grid')!.querySelectorAll('dt'),
        ].map((dt) => dt.textContent?.trim());
        expect(labels).toEqual(['Date', 'Cashier', 'Sale']);
    });

    it('lays out the footer: Void/Refund left, Close right (#236)', async () => {
        await openSale(CASH_SALE);
        const footer = byTestId('sale-footer')!;
        expect(footer.className).toContain('sm:justify-between');
        expect(footer.className).toContain('flex-col');
        const texts = [...footer.querySelectorAll('button')].map((b) =>
            b.textContent?.trim(),
        );
        expect(texts).toEqual(['Void sale', 'Refund sale', 'Close']);
        for (const b of footer.querySelectorAll('button'))
            expect(b.className).toContain('min-h-11');
        const actions = byTestId('sale-reverse-actions')!;
        for (const b of actions.querySelectorAll('button'))
            expect(b.className).toContain('text-danger');
        expect(byTestId('sale-close')?.className).toContain('sm:ml-auto');
    });

    it('shows only Close, on the right, for a reversed sale (#236)', async () => {
        await openSale(APPROVED);
        const footer = byTestId('sale-footer')!;
        expect(
            [...footer.querySelectorAll('button')].map((b) =>
                b.textContent?.trim(),
            ),
        ).toEqual(['Close']);
        expect(byTestId('sale-reverse-actions')).toBeNull();
        expect(byTestId('sale-close')?.className).toContain('sm:ml-auto');
    });

    it('shows a zero Change for exact cash', async () => {
        await openSale({
            ...CASH_SALE,
            tenders: [{ type: TenderType.CASH, amount: 80_000 }],
            changeGiven: 0,
        });
        expect(byTestId('sale-change')?.textContent).toContain('0.00');
    });

    it('shows no Change for GCash only, and the reference to a seller', async () => {
        useAuthStore().user = { username: 'ana', roles: [Role.Seller] };
        await openSale({
            ...CASH_SALE,
            paymentType: PaymentType.GCASH,
            tenders: [{ type: TenderType.GCASH, amount: 80_000 }],
            changeGiven: 0,
            referenceNumber: '1234567890123',
        });
        expect(byTestId('sale-change')).toBeNull();
        expect(byTestId('sale-reference')?.textContent).toContain(
            '1234567890123',
        );
    });

    it('shows when an offline sale occurred and when it was recorded', async () => {
        await openSale({
            ...CASH_SALE,
            offline: true,
            soldAt: '2026-09-24T01:00:00.000Z',
            stockShortfall: true,
            lateOffline: true,
        });
        const date = byTestId('sale-detail-date')!;
        expect(date.textContent).toContain('Occurred');
        expect(date.querySelector('time')?.getAttribute('datetime')).toBe(
            '2026-09-24T01:00:00.000Z',
        );
        expect(
            byTestId('sale-detail-recorded')
                ?.querySelector('time')
                ?.getAttribute('datetime'),
        ).toBe('2026-09-25T01:00:00.000Z');
        expect(byTestId('sale-offline-notice')?.textContent).toContain(
            'Stock shortfall',
        );
        expect(byTestId('sale-offline-notice')?.textContent).toContain(
            'addendum',
        );
    });

    it('lists lines compactly, measured quantities per unit', async () => {
        serve(CASH_SALE, []);
        const serveRest = api.get.getMockImplementation()!;
        api.get.mockImplementation((url, config) =>
            url === '/sales/details/sale1'
                ? Promise.resolve({
                      data: [
                          {
                              _id: 'l1',
                              product: { name: 'Rice' },
                              quantity: 450,
                              unit: 'KG',
                              unitPrice: 18_000,
                          },
                      ],
                  })
                : serveRest(url, config),
        );
        await mountAndOpen();

        const line = byTestId('sale-line')!;
        expect(line.textContent).toContain('Rice');
        expect(line.textContent).toContain('0.45');
        expect(line.textContent).toContain('81.00');
        expect(byTestId('details-table')?.querySelector('thead')).toBeNull();
    });

    it('shows approvers and the paying shift to an admin', async () => {
        await openSale(APPROVED);
        const facts = byTestId('sale-admin-facts')?.textContent ?? '';
        expect(facts).toContain('Discount approved by');
        expect(facts).toContain('maria');
        expect(facts).toContain('Refund approved by');
        expect(facts).toContain('sam');
        expect(facts).toContain('#12345678');
        expect(byTestId('sale-reversal')?.textContent).toContain('750.00');
        expect(byTestId('sale-discount')?.textContent).toContain(
            'loyal customer',
        );
    });

    it('never shows approvers or the paying shift to a seller', async () => {
        useAuthStore().user = { username: 'ana', roles: [Role.Seller] };
        await openSale(APPROVED);
        expect(byTestId('sale-admin-facts')).toBeNull();
        expect(document.body.textContent).not.toContain('maria');
        expect(byTestId('sale-reversal')?.textContent).toContain('returned');
    });

    it('swaps the receipt for the void panel, and Back keeps the inputs', async () => {
        await openSale(CASH_SALE, [
            openShift(OTHER_SHIFT, 'ben'),
            openShift('shift-3', 'cy'),
        ]);
        button('Void sale')!.click();
        await flush();
        expect(byTestId('sale-receipt')).toBeNull();
        expect(byTestId('reversal-panel')).not.toBeNull();
        expect(byTestId('reversal-amount')?.textContent).toContain('800.00');
        const confirm = byTestId('reversal-confirm') as HTMLButtonElement;
        expect(confirm.disabled).toBe(true);
        expect(confirm.className).toContain('disabled:bg-paper');

        const reason =
            document.querySelector<HTMLInputElement>('#reversal-reason')!;
        reason.value = 'mis-ring';
        reason.dispatchEvent(new Event('input'));
        const select = document.querySelector<HTMLSelectElement>(
            '[data-testid="payout-shift"] select',
        )!;
        select.value = OTHER_SHIFT;
        select.dispatchEvent(new Event('change'));
        await flush();

        byTestId('reversal-back')!.click();
        await flush();
        expect(byTestId('reversal-panel')).toBeNull();
        expect(byTestId('sale-receipt')).not.toBeNull();

        button('Void sale')!.click();
        await flush();
        expect(
            document.querySelector<HTMLInputElement>('#reversal-reason')!.value,
        ).toBe('mis-ring');
        expect(
            document.querySelector<HTMLSelectElement>(
                '[data-testid="payout-shift"] select',
            )!.value,
        ).toBe(OTHER_SHIFT);
        expect(
            (byTestId('reversal-confirm') as HTMLButtonElement).disabled,
        ).toBe(false);

        // Another type starts afresh.
        byTestId('reversal-back')!.click();
        await flush();
        button('Refund sale')!.click();
        await flush();
        expect(
            document.querySelector<HTMLInputElement>('#reversal-reason')!.value,
        ).toBe('');
    });

    /** `/shifts` answers held until the test resolves them, in call order. */
    function serveDeferredShifts(sales: object[]) {
        const pending: ((open: object[]) => void)[] = [];
        api.get.mockImplementation((url: string) => {
            if (url === '/sales')
                return Promise.resolve({
                    data: { data: sales, totalItems: sales.length },
                });
            if (url === '/shifts')
                return new Promise((resolve) =>
                    pending.push((open) =>
                        resolve({
                            data: { data: open, totalItems: open.length },
                        }),
                    ),
                );
            return Promise.resolve({ data: [] });
        });
        return pending;
    }

    it('keeps only the latest open-shift answer, out of order', async () => {
        const pending = serveDeferredShifts([CASH_SALE]);
        await mountAndOpen();
        button('Void sale')!.click();
        await flush();
        byTestId('reversal-back')!.click();
        await flush();
        button('Void sale')!.click();
        await flush();

        // The latest answer: the own shift is open.
        pending[1]!([openShift(OWN_SHIFT, 'ana')]);
        await flush();
        expect(byTestId('payout-own-shift')).not.toBeNull();
        // The stale one lands late and changes nothing.
        pending[0]!([]);
        await flush();
        expect(byTestId('payout-own-shift')).not.toBeNull();
        expect(byTestId('payout-no-open-shift')).toBeNull();
    });

    it('drops an open-shift answer for a sale switched away from', async () => {
        const SALE_B = { ...CASH_SALE, _id: 'sale2', shift: undefined };
        const pending = serveDeferredShifts([CASH_SALE, SALE_B]);
        await mountAndOpen();
        button('Void sale')!.click();
        await flush();
        button('Back')!.click();
        await flush();
        document
            .querySelectorAll<HTMLElement>('tbody tr.cursor-pointer')[1]!
            .click();
        await flush();
        button('Void sale')!.click();
        await flush();
        expect(byTestId('payout-loading')).not.toBeNull();

        // The first sale's answer lands late: still loading for sale2.
        pending[0]!([openShift(OWN_SHIFT, 'ana')]);
        await flush();
        expect(byTestId('payout-loading')).not.toBeNull();
        expect(byTestId('payout-own-shift')).toBeNull();

        pending[1]!([openShift(OTHER_SHIFT, 'ben')]);
        await flush();
        expect(
            document.querySelector('[data-testid="payout-shift"] select'),
        ).not.toBeNull();
    });
});
