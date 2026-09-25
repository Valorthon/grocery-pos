import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import Dashboard from './Dashboard.vue';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/axios', () => ({ default: { get, post: vi.fn() } }));

const NOW = new Date().toISOString();

/** What GET /dashboard returns to a non-admin (issue #13): no money. */
const STATS = {
    totalProducts: 40,
    lowStockCount: 3,
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
