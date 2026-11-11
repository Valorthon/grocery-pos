import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import Dashboard from './Dashboard.vue';
import { useAuthStore } from '@/stores/auth';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/axios', () => ({ default: { get, post: vi.fn() } }));

const NOW = new Date().toISOString();

/** What GET /dashboard returns to a non-admin (issue #13): no money. */
const STATS = {
    totalProducts: 40,
    lowStockCount: 3,
    outOfStockCount: 7,
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
    todaySalesCount: 2,
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

/** Mounted as an inventory role, so both sections show (#212). */
async function render(payload: unknown, roles: string[] = ['RESTOCKER']) {
    get.mockResolvedValue({ data: payload });
    const pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().user = { userId: 'u', username: 'u', roles: roles as never };
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Dashboard);
    app.use(pinia);
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
        // Today's Sales is ADMIN-only (#213).
        expect(text).not.toContain("Today's Sales");
        expect(text).toContain('Restocked: weekly delivery');
    });
});

describe('Dashboard stock tiles (issue #16)', () => {
    const tile = (key: string) =>
        document.querySelector(`[data-stat="${key}"]`);

    it.each([
        ['a non-admin', STATS],
        ['an admin', WITH_MONEY],
    ])('shows low-stock and out-of-stock counts to %s', async (_, payload) => {
        await render(payload);

        expect(tile('lowStock')?.querySelector('.num')?.textContent).toContain(
            '3',
        );
        expect(
            tile('outOfStock')?.querySelector('.num')?.textContent,
        ).toContain('7');
    });

    it('shows a dash while the count is missing', async () => {
        const { outOfStockCount: _omit, ...older } = STATS;
        void _omit;
        await render(older);

        expect(
            tile('outOfStock')?.querySelector('.num')?.textContent,
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

describe('Dashboard recent activity (issue #20)', () => {
    const ago = (minutes: number) =>
        new Date(Date.now() - minutes * 60_000).toISOString();

    it('lists the newest first across kinds, cut to 7 after sorting', async () => {
        // Eight older sales, then a newer restock and a newest adjustment:
        // sorting after formatting ("2 hr ago") kept the sales and hid both.
        const sales = Array.from({ length: 8 }, (_, i) => ({
            _id: `s${i}`,
            amount: 100 * (i + 1),
            paymentType: 'CASH',
            status: 'COMPLETED',
            createdAt: ago(120 + i),
            cashier: { name: 'ana' },
        }));
        await render({
            ...WITH_MONEY,
            recentSales: sales,
            recentRestocks: [
                {
                    _id: 'r1',
                    description: 'weekly delivery',
                    createdAt: ago(30),
                    restockedBy: { name: 'rex' },
                },
            ],
            recentAdjustments: [
                {
                    _id: 'a1',
                    description: 'recount',
                    createdAt: ago(5),
                    adjustedBy: { name: 'ada' },
                },
            ],
        });

        const titles = [
            ...document.querySelectorAll('[data-testid="activity"]'),
        ].map((el) => el.querySelector('.text-sm')?.textContent?.trim());

        expect(titles).toHaveLength(7);
        expect(titles.slice(0, 3)).toEqual([
            'Adjusted: recount',
            'Restocked: weekly delivery',
            'Sale: ₱1.00',
        ]);
        // The oldest sales are the ones cut.
        expect(titles).not.toContain('Sale: ₱8.00');
        expect(titles).not.toContain('Sale: ₱7.00');
    });
});

async function renderWithRouter(roles: string[], payload: unknown) {
    const { createRouter, createMemoryHistory } = await import('vue-router');
    const { useAuthStore } = await import('@/stores/auth');
    const pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().user = {
        userId: 'u1',
        username: 'u1',
        roles: roles as never,
    };
    const stub = { template: '<div>page</div>' };
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'Dashboard', component: Dashboard },
            { path: '/inventory', name: 'Inventories', component: stub },
            { path: '/products', name: 'Products', component: stub },
            { path: '/sales', name: 'SalesHistory', component: stub },
        ],
    });
    await router.push('/');
    await router.isReady();
    get.mockResolvedValue({ data: payload });
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Dashboard);
    app.use(pinia);
    app.use(router);
    app.mount(host);
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
        await nextTick();
    }
    return router;
}

/** Each tile's key and its link (null when it is not a link). */
function tileLinks(): Record<string, string | null> {
    const links: Record<string, string | null> = {};
    for (const el of document.querySelectorAll('[data-stat]')) {
        links[el.getAttribute('data-stat') ?? ''] =
            el.tagName === 'A' ? el.getAttribute('href') : null;
    }
    return links;
}

function sectionKeys(): string[] {
    return [...document.querySelectorAll('[data-section]')].map(
        (el) => el.getAttribute('data-section') ?? '',
    );
}

/** Tile keys per section, in order. */
function sectionTiles(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const el of document.querySelectorAll('[data-section]'))
        out[el.getAttribute('data-section') ?? ''] = [
            ...el.querySelectorAll('[data-stat]'),
        ].map((t) => t.getAttribute('data-stat') ?? '');
    return out;
}

describe('Dashboard sections (issue #212)', () => {
    it('gives an admin Needs attention then Overview, with all six tiles', async () => {
        await renderWithRouter(['ADMIN'], WITH_MONEY);
        expect(sectionKeys()).toEqual(['attention', 'overview']);
        expect(sectionTiles()).toEqual({
            attention: ['expiring', 'lowStock', 'outOfStock'],
            overview: ['products', 'todaySales', 'todayRevenue'],
        });
        const headings = [...document.querySelectorAll('[data-section] h2')];
        expect(headings.map((h) => h.textContent?.trim())).toEqual([
            'Needs attention',
            'Overview',
        ]);
    });

    it.each([['RESTOCKER'], ['ADJUSTER']])(
        'gives %s both sections, Overview without revenue',
        async (role) => {
            await renderWithRouter([role], STATS);
            expect(sectionTiles()).toEqual({
                attention: ['expiring', 'lowStock', 'outOfStock'],
                overview: ['products'],
            });
        },
    );

    it('keeps Needs attention when every count is zero', async () => {
        await renderWithRouter(['RESTOCKER'], {
            ...STATS,
            lowStockCount: 0,
            outOfStockCount: 0,
            expiringBatchCount: 0,
        });
        expect(sectionKeys()).toEqual(['attention', 'overview']);
    });

    it('links Out of Stock to the out-of-stock inventory list', async () => {
        const router = await renderWithRouter(['ADJUSTER'], STATS);
        const link = document.querySelector<HTMLAnchorElement>(
            '[data-stat="outOfStock"]',
        );
        expect(link?.getAttribute('href')).toBe('/inventory?outOfStock=true');
        link!.dispatchEvent(
            new MouseEvent('click', { bubbles: true, button: 0 }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(router.currentRoute.value).toMatchObject({
            name: 'Inventories',
            query: { outOfStock: 'true' },
        });
    });
});

describe('Dashboard tiles per role (issue #166)', () => {
    const INVENTORY_LINKS = {
        expiring: '/inventory?expiring=true',
        products: null,
        lowStock: '/inventory?lowStock=true',
        outOfStock: '/inventory?outOfStock=true',
    };

    it.each([['RESTOCKER'], ['ADJUSTER']])(
        'links the inventory tiles for %s, without money',
        async (role) => {
            await renderWithRouter([role], STATS);
            expect(tileLinks()).toEqual(INVENTORY_LINKS);
            expect(document.body.textContent).not.toContain('₱');
            expect(
                document.querySelector('[data-testid="recent-sales"]'),
            ).toBeNull();
        },
    );

    it('hides Needs attention from a USER_MANAGER: Overview only, no links', async () => {
        await renderWithRouter(['USER_MANAGER'], STATS);
        expect(tileLinks()).toEqual({ products: null });
        expect(sectionKeys()).toEqual(['overview']);
        expect(document.body.textContent).not.toContain('Needs attention');
        expect(document.querySelector('a')).toBeNull();
    });

    it('gives an admin the money tile, links and the sales table', async () => {
        await renderWithRouter(['ADMIN'], WITH_MONEY);
        expect(tileLinks()).toEqual({
            ...INVENTORY_LINKS,
            todaySales: null,
            todayRevenue: null,
        });
        expect(
            document
                .querySelector('[data-testid="recent-sales-all"]')
                ?.getAttribute('href'),
        ).toBe('/sales');
        const amount = document.querySelector(
            '[data-testid="recent-sales"] td.text-right',
        );
        expect(amount?.classList.contains('num')).toBe(true);
        expect(amount?.textContent).toContain('₱125.00');
    });

    it('badges recent sales by status and opens Sale Details on click, Enter or Space (#243)', async () => {
        const ID = 'a'.repeat(24);
        const router = await renderWithRouter(['ADMIN'], {
            ...WITH_MONEY,
            recentSales: [
                { ...WITH_MONEY.recentSales[0], _id: ID },
                {
                    ...WITH_MONEY.recentSales[0],
                    _id: 'b'.repeat(24),
                    status: 'VOIDED',
                },
                {
                    ...WITH_MONEY.recentSales[0],
                    _id: 'c'.repeat(24),
                    status: 'REFUNDED',
                },
            ],
        });
        const badges = [
            ...document.querySelectorAll('[data-testid="recent-sale-status"]'),
        ];
        expect(badges.map((b) => b.textContent?.trim())).toEqual([
            'Completed',
            'Voided',
            'Refunded',
        ]);
        expect(badges[0].className).toContain('bg-success-bg');
        expect(badges[1].className).toContain('bg-danger-bg');
        expect(badges[2].className).toContain('bg-warning-bg');

        const rows = [
            ...document.querySelectorAll<HTMLElement>(
                '[data-testid="recent-sales"] tr[data-row-click]',
            ),
        ];
        expect(rows).toHaveLength(3);
        rows[0].click();
        await new Promise((r) => setTimeout(r, 0));
        expect(router.currentRoute.value).toMatchObject({
            name: 'SalesHistory',
            query: { saleNumber: ID, details: '1' },
        });
        for (const key of ['Enter', ' ']) {
            await router.push('/');
            rows[1].dispatchEvent(
                new KeyboardEvent('keydown', { key, bubbles: true }),
            );
            await new Promise((r) => setTimeout(r, 0));
            expect(router.currentRoute.value.query).toEqual({
                saleNumber: 'b'.repeat(24),
                details: '1',
            });
        }
    });

    it('marks attention tiles with a tone a screen reader hears', async () => {
        await renderWithRouter(['ADJUSTER'], STATS);
        const low = document.querySelector('[data-stat="lowStock"]');
        expect(low?.querySelector('[data-tone-stripe]')).not.toBeNull();
        expect(low?.querySelector('.sr-only')?.textContent).toContain(
            'warning',
        );
        expect(
            document
                .querySelector('[data-stat="products"]')
                ?.querySelector('[data-tone-stripe]'),
        ).toBeNull();
        const out = document.querySelector('[data-stat="outOfStock"]');
        expect(out?.querySelector('.sr-only')?.textContent).toContain(
            'needs attention',
        );
    });

    it('drops the tone when the count is zero', async () => {
        await renderWithRouter(['ADJUSTER'], {
            ...STATS,
            lowStockCount: 0,
            outOfStockCount: 0,
        });
        for (const key of ['lowStock', 'outOfStock']) {
            expect(
                document
                    .querySelector(`[data-stat="${key}"]`)
                    ?.querySelector('[data-tone-stripe]'),
            ).toBeNull();
        }
    });

    it('gives an admin one alert and one Retry when the first load fails', async () => {
        const { useAuthStore } = await import('@/stores/auth');
        const pinia = createPinia();
        setActivePinia(pinia);
        useAuthStore().user = {
            userId: 'a',
            username: 'a',
            roles: ['ADMIN'] as never,
        };
        get.mockRejectedValue(new Error('down'));
        const host = document.createElement('div');
        document.body.appendChild(host);
        app = createApp(Dashboard);
        app.use(pinia);
        app.mount(host);
        for (let i = 0; i < 5; i++) {
            await Promise.resolve();
            await nextTick();
        }
        expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
        expect(
            [...document.querySelectorAll('button')].filter((b) =>
                b.textContent?.includes('Retry'),
            ),
        ).toHaveLength(1);
        expect(
            document.querySelector('[data-testid="recent-sales"]'),
        ).toBeNull();
    });
});

describe('Dashboard loading (issue #166)', () => {
    it('shows skeletons, not dashes, until the first answer', async () => {
        const { useAuthStore } = await import('@/stores/auth');
        const pinia = createPinia();
        setActivePinia(pinia);
        useAuthStore().user = {
            userId: 'a',
            username: 'a',
            roles: ['ADMIN'] as never,
        };
        get.mockReturnValue(new Promise(() => {}));
        const host = document.createElement('div');
        document.body.appendChild(host);
        app = createApp(Dashboard);
        app.use(pinia);
        app.mount(host);
        await nextTick();

        const tiles = [...document.querySelectorAll('[data-stat]')];
        expect(tiles).toHaveLength(6);
        for (const t of tiles) {
            expect(t.querySelector('[data-skeleton]')).not.toBeNull();
            expect(t.getAttribute('aria-busy')).toBe('true');
        }
        expect(host.textContent).not.toContain('-');
        // The admin's sales table shows its skeleton rows meanwhile.
        expect(
            document.querySelectorAll(
                '[data-testid="recent-sales"] .animate-pulse',
            ).length,
        ).toBeGreaterThan(0);
        expect(host.textContent).not.toContain('₱');
    });

    it.each([['RESTOCKER'], ['ADJUSTER'], ['USER_MANAGER']])(
        'hides the sales and revenue skeletons from %s',
        async (role) => {
            const { useAuthStore } = await import('@/stores/auth');
            const pinia = createPinia();
            setActivePinia(pinia);
            useAuthStore().user = {
                userId: 'u',
                username: 'u',
                roles: [role] as never,
            };
            get.mockReturnValue(new Promise(() => {}));
            const host = document.createElement('div');
            document.body.appendChild(host);
            app = createApp(Dashboard);
            app.use(pinia);
            app.mount(host);
            await nextTick();
            expect(
                document.querySelector('[data-testid="recent-sales"]'),
            ).toBeNull();
        },
    );
});

it('links the low-stock tile to the filtered inventory list for inventory roles', async () => {
    const { createRouter, createMemoryHistory } = await import('vue-router');
    const { useAuthStore } = await import('@/stores/auth');
    const { Role } = await import('@grocery-pos/contracts');
    const pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().user = {
        userId: 'restocker',
        username: 'restocker',
        roles: [Role.Restocker],
    };
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'Dashboard', component: Dashboard },
            {
                path: '/products',
                name: 'Products',
                component: { template: '<div>Products</div>' },
            },
            {
                path: '/inventory',
                name: 'Inventories',
                component: { template: '<div>Inventory</div>' },
            },
        ],
    });
    await router.push('/');
    await router.isReady();
    get.mockResolvedValue({ data: STATS });
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Dashboard);
    app.use(pinia);
    app.use(router);
    app.mount(host);
    for (let i = 0; i < 5; i++) await nextTick();
    const link = document.querySelector<HTMLAnchorElement>(
        'a[href="/inventory?lowStock=true"]',
    );
    expect(link?.textContent).toContain('Low Stock Items');
    link!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(router.currentRoute.value).toMatchObject({
        name: 'Inventories',
        query: { lowStock: 'true' },
    });
});

describe('Dashboard card subtitles (#213)', () => {
    const hint = (key: string) =>
        document.querySelector(`[data-stat="${key}"]`)?.textContent ?? '';

    it('explains every card, with the configured expiry window', async () => {
        await render(
            { ...WITH_MONEY, expiringBatchCount: 2, expiryAlertDays: 14 },
            ['ADMIN'],
        );
        expect(hint('expiring')).toContain(
            'Batches in stock expiring within 14 days or already expired',
        );
        expect(hint('products')).toContain('Active products');
        expect(hint('lowStock')).toContain(
            'Active products at or below their reorder level',
        );
        expect(hint('outOfStock')).toContain(
            'Active products with zero or less on hand',
        );
        expect(hint('todaySales')).toContain(
            'Sales completed today; voids and refunds excluded',
        );
        expect(hint('todayRevenue')).toContain(
            "Today's sales total; voids and refunds excluded",
        );
    });

    it('says 1 day, and 7 days when the API names no window', async () => {
        await render({ ...STATS, expiringBatchCount: 0, expiryAlertDays: 1 });
        expect(hint('expiring')).toContain('within 1 day or');
        app?.unmount();
        app = null;
        document.body.innerHTML = '';
        await render({ ...STATS, expiringBatchCount: 0 });
        expect(hint('expiring')).toContain('within 7 days or');
    });

    it("hides Today's Sales from non-admins", async () => {
        await render(STATS, ['USER_MANAGER']);
        expect(document.querySelector('[data-stat="todaySales"]')).toBeNull();
    });
});
