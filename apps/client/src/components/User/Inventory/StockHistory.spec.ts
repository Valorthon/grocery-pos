import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { createApp, type App } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import {
    Role,
    StockMovementType,
    StockMovementSource,
    UnitOfMeasure,
    type StockMovementView,
} from '@grocery-pos/contracts';
import { useAuthStore } from '@/stores/auth';
import { click, flush, field, openDates, pick } from '@/testing/form-dom';
import StockHistory from './StockHistory.vue';
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
let app: App | undefined,
    pinia = createPinia();
const row = (): StockMovementView => ({
    _id: 'movement',
    product: '507f1f77bcf86cd799439001',
    type: StockMovementType.SALE,
    quantity: -450,
    balanceAfter: 1550,
    unit: UnitOfMeasure.KG,
    sequence: 1,
    refModel: StockMovementSource.SALE,
    refId: '507f1f77bcf86cd799439099',
    user: { _id: 'actor', name: 'Cashier' },
    occurredAt: '2026-11-01T00:00:00Z',
    createdAt: '2026-11-02T00:00:00Z',
    historical: false,
});
const product = {
    _id: '507f1f77bcf86cd799439001',
    name: 'Milk',
    unit: UnitOfMeasure.KG,
};
beforeEach(() => {
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().user = {
        userId: 'actor',
        username: 'admin',
        roles: [Role.Admin],
    };
    api.get.mockImplementation(async (url: string) =>
        url.endsWith('/integrity')
            ? {
                  data: {
                      product: product._id,
                      stock: 1550,
                      movementTotal: 1550,
                      difference: 0,
                      matches: true,
                  },
              }
            : { data: { data: [row()], totalItems: 21 } },
    );
});
afterEach(() => {
    app?.unmount();
    app = undefined;
    disposePinia(pinia);
    document.body.innerHTML = '';
    vi.clearAllMocks();
});
const closed = vi.fn();
async function mount(props: Record<string, unknown> = {}) {
    const host = document.createElement('div');
    document.body.append(host);
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            {
                path: '/sales',
                name: 'SalesHistory',
                component: { template: '<div />' },
            },
        ],
    });
    app = createApp(StockHistory, { product, onClose: closed, ...props });
    app.use(pinia);
    app.use(router);
    app.mount(host);
    await flush();
}
it('shows posting and original occurrence, signed measured changes, source link and integrity without financial fields', async () => {
    await mount();
    expect(document.body.textContent).toContain('-0.450 kg');
    expect(document.body.textContent).toContain('1.550 kg');
    expect(badge()).toBe('Reconciled');
    expect(document.querySelector('a')?.getAttribute('href')).toContain(
        'saleNumber=507f1f77bcf86cd799439099',
    );
    await click('Next');
    expect(api.get).toHaveBeenCalledWith(`/products/${product._id}/movements`, {
        params: { page: 2, limit: 20 },
    });
    await click('Previous');
});
async function setDate(label: string, value: string) {
    field(label).value = value;
    field(label).dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
}
const badge = () =>
    document.querySelector('[data-testid="ledger-badge"]')?.textContent?.trim();
const tile = (label: string) =>
    [...document.querySelectorAll('[data-testid="stock-history-tiles"] > *')]
        .find((el) => el.querySelector('p')?.textContent?.trim() === label)
        ?.textContent?.replace(label, '')
        .trim();
it('applies a date edit at once on page 1, retries applied filters and holds a reversed range', async () => {
    await mount();
    await click('Next');
    await openDates();
    await setDate('From', '2026-11-01');
    expect(api.get).toHaveBeenLastCalledWith(
        `/products/${product._id}/movements`,
        { params: { from: '2026-11-01', to: undefined, page: 1, limit: 20 } },
    );
    api.get.mockRejectedValueOnce(new Error('Network'));
    await click('Next');
    expect(document.body.textContent).toContain('Could not load stock history');
    await setDate('To', '2026-10-01');
    await click('Retry');
    expect(api.get).toHaveBeenLastCalledWith(
        `/products/${product._id}/movements`,
        { params: { from: '2026-11-01', to: undefined, page: 2, limit: 20 } },
    );
});
it('applies a preset from the store date and Clear resets the range', async () => {
    api.get.mockImplementation(async (url: string) =>
        url === '/settings/today'
            ? { data: { today: '2026-11-11', timezone: 'Asia/Manila' } }
            : url.endsWith('/integrity')
              ? { data: { stock: 1550, movementTotal: 1550, matches: true } }
              : { data: { data: [row()], totalItems: 21 } },
    );
    await mount();
    await openDates();
    await pick('Dates', 'Today');
    expect(api.get).toHaveBeenLastCalledWith(
        `/products/${product._id}/movements`,
        {
            params: {
                from: '2026-11-11',
                to: '2026-11-11',
                page: 1,
                limit: 20,
            },
        },
    );
    const trigger = document.querySelector('[data-date-range]')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
    // Escape closed only the Dates dialog, not Stock history.
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(closed).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Stock history — Milk');
    await click('Clear Filters');
    expect(api.get).toHaveBeenLastCalledWith(
        `/products/${product._id}/movements`,
        { params: { from: undefined, to: undefined, page: 1, limit: 20 } },
    );
});
it('shows Current stock from the server, reorder level and EAN tiles', async () => {
    await mount({ ean: '4800000000017', reorderLevel: '10.000 kg' });
    expect(tile('Current stock')).toBe('1.550 kg');
    expect(tile('Reorder level')).toBe('10.000 kg');
    expect(tile('EAN')).toBe('4800000000017');
});
it('shows skeletons while the check loads', async () => {
    api.get.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(
        document.querySelector('[data-testid="ledger-status"] [data-skeleton]'),
    ).not.toBeNull();
    expect(document.querySelectorAll('[data-skeleton]').length).toBe(2);
    expect(badge()).toBeUndefined();
});
it('shows Unavailable and no stock when the check fails, and retries it', async () => {
    api.get.mockImplementation(async (url: string) => {
        if (url.endsWith('/integrity')) throw new Error('down');
        return { data: { data: [row()], totalItems: 1 } };
    });
    await mount();
    expect(badge()).toBe('Unavailable');
    expect(tile('Current stock')).toBe('—');
    expect(document.body.textContent).not.toContain('Reconciled');
    expect(document.body.textContent).toContain('-0.450 kg');
    api.get.mockImplementation(async (url: string) =>
        url.endsWith('/integrity')
            ? { data: { stock: 1550, movementTotal: 1550, matches: true } }
            : { data: { data: [row()], totalItems: 1 } },
    );
    await click('Retry check');
    expect(badge()).toBe('Reconciled');
});
it('keeps the tiles when the movements fail', async () => {
    api.get.mockImplementation(async (url: string) => {
        if (url.endsWith('/integrity'))
            return {
                data: { stock: 1550, movementTotal: 1550, matches: true },
            };
        throw new Error('down');
    });
    await mount();
    expect(
        document.querySelector('[data-testid="table-error"]'),
    ).not.toBeNull();
    expect(tile('Current stock')).toBe('1.550 kg');
    expect(badge()).toBe('Reconciled');
});
it('loads the check once, not on every page change', async () => {
    await mount();
    await click('Next');
    expect(
        api.get.mock.calls.filter(([url]) => String(url).endsWith('/integrity'))
            .length,
    ).toBe(1);
});
it('opens the balances note by keyboard focus with aria-describedby', async () => {
    await mount();
    const button = document.querySelector<HTMLButtonElement>(
        '[data-info-tooltip]',
    )!;
    const tip = document.getElementById(
        button.getAttribute('aria-describedby')!,
    )!;
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toContain('Balances follow posting order');
    expect(tip.className).toContain('hidden');
    button.focus();
    await flush();
    expect(tip.className).not.toContain('hidden');
    button.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await flush();
    expect(tip.className).toContain('hidden');
    // Escape closed the tooltip only, not the dialog.
    expect(document.body.textContent).toContain('Stock history — Milk');
});
it('shows derived unattributed history and flags ledger mismatch', async () => {
    api.get.mockImplementation(async (url: string) =>
        url.endsWith('/integrity')
            ? { data: { stock: 3, movementTotal: 2, matches: false } }
            : {
                  data: {
                      data: [
                          {
                              ...row(),
                              type: StockMovementType.OPENING,
                              refModel: StockMovementSource.OPENING,
                              refId: undefined,
                              user: null,
                              historical: true,
                          },
                      ],
                      totalItems: 1,
                  },
              },
    );
    await mount();
    expect(document.body.textContent).toContain('derived history');
    expect(document.body.textContent).toContain('Unattributed opening balance');
    expect(document.body.textContent).toContain('Unknown / unattributed');
    expect(badge()).toBe('Mismatch');
    const alert = document.querySelector('[role="alert"]')!.textContent!;
    expect(alert).toContain('Stock 0.003 kg');
    expect(alert).toContain('Ledger 0.002 kg');
    expect(alert).toContain('Investigate before posting more stock');
});
it('does not offer financial source access to an inventory-only user', async () => {
    useAuthStore().user!.roles = [Role.Restocker];
    await mount();
    expect(document.querySelector('a')).toBeNull();
    expect(document.body.textContent).toContain('507f1f77bcf86cd799439099');
});
it('drops late results when the owner changes or component unmounts', async () => {
    let resolve!: (v: unknown) => void;
    api.get.mockReturnValue(
        new Promise((done) => {
            resolve = done;
        }),
    );
    await mount();
    useAuthStore().user = {
        userId: 'other',
        username: 'other',
        roles: [Role.Adjuster],
    };
    await flush();
    resolve({ data: { data: [row()], totalItems: 1 } });
    await flush();
    expect(document.body.textContent).not.toContain('Cashier');
    app?.unmount();
    app = undefined;
});
it('right-aligns quantity columns with tabular figures (#170)', async () => {
    await mount();
    const heads = [...document.querySelectorAll('thead th')];
    for (const title of ['Change', 'Balance after'])
        expect(
            heads.find((th) => th.textContent?.trim() === title)!.className,
        ).toContain('text-right num');
});
it('shows an empty state once loaded with no movements (#170)', async () => {
    api.get.mockImplementation(async (url: string) =>
        url.endsWith('/integrity')
            ? { data: { stock: 0, movementTotal: 0, matches: true } }
            : { data: { data: [], totalItems: 0 } },
    );
    await mount();
    expect(document.body.textContent).toContain('No matching stock movements');
});
it('shows a load failure in the table with Retry, not the empty state (#170)', async () => {
    api.get.mockRejectedValue(new Error('down'));
    await mount();
    expect(
        document.querySelector('[data-testid="table-error"]'),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain(
        'No matching stock movements',
    );
});
it('replaces the previous page with a skeleton while the next page loads (#170)', async () => {
    await mount();
    expect(document.body.textContent).toContain('-0.450 kg');
    api.get.mockReturnValue(new Promise(() => {}));
    await click('Next');
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
    expect(document.body.textContent).not.toContain('-0.450 kg');
});
