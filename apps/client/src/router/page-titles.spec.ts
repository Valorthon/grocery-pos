import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import router from './index';
import { pageTitle, routeDescription, routeTitle } from './page-title';

vi.mock('@/axios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

const source = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');

/** Every routed page (a record with a name and no children). */
const pages = router
    .getRoutes()
    .filter((r) => r.name && r.children.length === 0);

describe('route titles (#159)', () => {
    it('gives every routed page a title', () => {
        expect(pages.length).toBeGreaterThan(20);
        const untitled = pages
            .filter((r) => !r.meta.title)
            .map((r) => String(r.name));
        expect(untitled).toEqual([]);
    });

    it('titles the low-stock list on its own, and plain Inventory without it', () => {
        const low = router.resolve('/admin/inventories?lowStock=true');
        expect(routeTitle(low)).toBe('Low stock');
        expect(pageTitle(routeTitle(low))).toBe('Low stock · Grocery POS');
        expect(routeTitle(router.resolve('/admin/inventories'))).toBe(
            'Inventory',
        );
        expect(
            routeTitle(router.resolve('/admin/inventories?lowStock=false')),
        ).toBe('Inventory');
    });

    it('tolerates a route with no meta or query', () => {
        expect(routeTitle({})).toBeUndefined();
    });
});

describe('route summaries (#262)', () => {
    const NONE = ['Dashboard', 'SellerDashboard', 'Sell', 'Login', 'NotFound'];

    it('gives every other page a summary of at most 110 characters', () => {
        const missing = pages
            .filter((r) => !NONE.includes(String(r.name)))
            .filter((r) => {
                const d = r.meta.description;
                return !d || d.length > 110;
            })
            .map((r) => String(r.name));
        expect(missing).toEqual([]);
    });

    it.each(NONE)('gives %s no summary', (name) => {
        expect(
            router.getRoutes().find((r) => r.name === name)?.meta,
        ).not.toHaveProperty('description');
    });

    it('keeps query variants within 110 characters', () => {
        for (const r of pages) {
            const q = r.meta.queryTitle;
            for (const t of q === undefined ? [] : [q].flat())
                expect(t.description?.length ?? 0).toBeLessThanOrEqual(110);
        }
    });

    it('picks the query variant, else the page summary', () => {
        const inv = routeDescription(router.resolve('/admin/inventories'));
        expect(inv).toMatch(/^Stock on hand/);
        expect(
            routeDescription(
                router.resolve('/admin/inventories?lowStock=true'),
            ),
        ).toMatch(/reorder level/);
        expect(
            routeDescription(
                router.resolve('/admin/inventories?outOfStock=true'),
            ),
        ).toMatch(/no stock left/);
        expect(
            routeDescription(router.resolve('/admin/inventories?lowStock=no')),
        ).toBe(inv);
        expect(routeDescription({})).toBeUndefined();
    });

    it('gives the two sales histories their own text', () => {
        const admin = routeDescription(router.resolve('/admin/sales'));
        const seller = routeDescription(router.resolve('/seller/orders'));
        expect(admin).toMatch(/void or refund/);
        expect(seller).toMatch(/^Your sales in your current shift/);
    });

    it('falls back to the page summary when a query variant has none', () => {
        expect(
            routeDescription({
                meta: {
                    description: 'Page',
                    queryTitle: { key: 'a', value: '1', title: 'A' },
                },
                query: { a: '1' },
            }),
        ).toBe('Page');
    });
});

/**
 * The admin views under /admin, read from the router's lazy imports. The
 * register (Sell.vue) and the seller dashboard have their own layout.
 */
const ADMIN_VIEWS = [
    ...source.matchAll(/import\('@\/(views\/User\/[^']+\.vue)'\)/g),
]
    .map((m) => m[1])
    .filter((f) => !/Sales\/(Sell|SellerDashboard)\.vue$/.test(f));

describe('admin page frame (#159)', () => {
    it('finds the admin views', () => {
        expect(ADMIN_VIEWS.length).toBeGreaterThan(18);
    });

    it.each(ADMIN_VIEWS)(
        '%s has one PageFrame (its one h1) and no h1 of its own',
        (file) => {
            const text = readFileSync(
                resolve(__dirname, '..', file),
                'utf8',
            ).replace(/<!--[\s\S]*?-->/g, '');
            expect(text.match(/<PageFrame\b/g)).toHaveLength(1);
            expect(text).not.toMatch(/<h1\b/);
            expect(text).not.toMatch(/<PageCard\b[^>]*\btitle=/s);
        },
    );
});
