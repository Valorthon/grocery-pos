import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import router from './index';
import { pageTitle, routeTitle } from './page-title';

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
