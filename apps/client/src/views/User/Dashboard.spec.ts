import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import Dashboard from './Dashboard.vue';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/axios', () => ({ default: { get, post: vi.fn() } }));

const NOW = new Date().toISOString();

/** What GET /dashboard returns to a non-admin (issue #13): no money. */
const STATS = {
    totalProducts: 40,
    lowStockCount: 3,
    outOfStockCount: 7,
    todaySalesCount: 2,
    recentRestocks: [
        {
            _id: 'r1',
            description: 'weekly delivery',
            createdAt: NOW,
            restockedBy: { name: 'rex' },
        },
    ],
    recentAdjustments: [],
};

/** What it returns to an admin. */
const WITH_MONEY = {
    ...STATS,
    todayRevenue: 12_500,
    recentSales: [
        {
            _id: 's1',
            amount: 12_500,
            paymentType: 'CASH',
            status: 'COMPLETED',
            createdAt: NOW,
            cashier: { name: 'ana' },
        },
    ],
};

let app: App | null = null;

beforeEach(() => {
    setActivePinia(createPinia());
    get.mockReset();
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function render(payload: unknown) {
    get.mockResolvedValue({ data: payload });
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Dashboard);
    app.use(createPinia());
    app.mount(host);
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
        await nextTick();
    }
    return host.textContent ?? '';
}

describe('Dashboard money figures (issue #13)', () => {
    it('shows revenue and recent sales to an admin', async () => {
        const text = await render(WITH_MONEY);

        expect(get).toHaveBeenCalledWith('/dashboard');
        expect(text).toContain("Today's Revenue");
        expect(text).toContain('₱125.00');
        expect(
            document.querySelector('[data-testid="recent-sales"]'),
        ).not.toBeNull();
        expect(text).toContain('ana');
    });

    it('renders stock and activity without money when the API sends none', async () => {
        const text = await render(STATS);

        expect(text).not.toContain("Today's Revenue");
        expect(text).not.toContain('₱');
        expect(
            document.querySelector('[data-testid="recent-sales"]'),
        ).toBeNull();
        expect(text).toContain('Total Products');
        expect(text).toContain('40');
        expect(text).toContain("Today's Sales");
        expect(text).toContain('Restocked: weekly delivery');
    });
});

describe('Dashboard stock tiles (issue #16)', () => {
    function tile(title: string) {
        return [...document.querySelectorAll('div.rounded-2xl')].find(
            (el) => el.querySelector('.text-xs')?.textContent?.trim() === title,
        );
    }

    it.each([
        ['a non-admin', STATS],
        ['an admin', WITH_MONEY],
    ])('shows low-stock and out-of-stock counts to %s', async (_, payload) => {
        await render(payload);

        expect(
            tile('Low Stock Items')?.querySelector('.text-2xl')?.textContent,
        ).toContain('3');
        expect(
            tile('Out of Stock Items')?.querySelector('.text-2xl')?.textContent,
        ).toContain('7');
    });

    it('shows a dash while the count is missing', async () => {
        const { outOfStockCount: _omit, ...older } = STATS;
        void _omit;
        await render(older);

        expect(
            tile('Out of Stock Items')?.querySelector('.text-2xl')?.textContent,
        ).toContain('-');
    });
});

describe('Dashboard load failure (issue #18)', () => {
    function httpError(status: number, message: string) {
        const config = { headers: new AxiosHeaders() };
        return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, {
            status,
            statusText: '',
            headers: {},
            config,
            data: { statusCode: status, message },
        } as AxiosResponse);
    }

    async function settle() {
        for (let i = 0; i < 5; i++) {
            await Promise.resolve();
            await nextTick();
        }
    }

    it('shows an error with a retry instead of empty placeholders', async () => {
        get.mockRejectedValueOnce(httpError(500, 'Internal server error'));
        const host = document.createElement('div');
        document.body.appendChild(host);
        app = createApp(Dashboard);
        app.use(createPinia());
        app.mount(host);
        await settle();

        const banner = document.querySelector(
            '[data-testid="dashboard-error"]',
        );
        expect(banner?.getAttribute('role')).toBe('alert');
        expect(banner?.textContent).toContain('Internal server error');
        expect(host.textContent).not.toContain('No recent activity');
        expect(document.querySelector('.animate-spin')).toBeNull();

        get.mockResolvedValueOnce({ data: STATS });
        [...banner!.querySelectorAll('button')]
            .find((b) => b.textContent?.includes('Retry'))!
            .click();
        await settle();

        expect(get).toHaveBeenCalledTimes(2);
        expect(
            document.querySelector('[data-testid="dashboard-error"]'),
        ).toBeNull();
        expect(host.textContent).toContain('Restocked: weekly delivery');
    });
});
