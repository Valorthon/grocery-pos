/**
 * The Roles page never promises a page a role cannot open (issue #24).
 *
 * Each row the page shows for a role (`appPermissionsOf`) names the client
 * pages that offer it; this resolves those routes in the real router and
 * checks, with the guard's own rule (`canOpenRoute`), that someone holding
 * only that role can open at least one of them.
 */
import { describe, expect, it, vi } from 'vitest';
import {
    appPermissionsOf,
    ASSIGNABLE_ROLES,
    PERMISSIONS,
    Role,
} from '@grocery-pos/contracts';
import { canOpenRoute, homeRouteFor, type RouteAccessMeta } from './access';

vi.mock('@/axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const { default: router } = await import('./index');

function metaOf(name: string): RouteAccessMeta {
    return router.resolve({ name }).meta as RouteAccessMeta;
}

describe('Roles page rows and client routes', () => {
    it('names only routes the router has', () => {
        for (const page of PERMISSIONS.flatMap((p) => p.pages ?? [])) {
            expect(router.hasRoute(page), page).toBe(true);
        }
    });

    it.each(ASSIGNABLE_ROLES)(
        'every row shown for %s names a page that role can open',
        (role) => {
            for (const permission of appPermissionsOf(role)) {
                const pages = permission.pages ?? [];
                expect(pages, permission.label).not.toHaveLength(0);
                expect(
                    pages.some((page) => canOpenRoute(metaOf(page), [role])),
                    `${role}: ${permission.label}`,
                ).toBe(true);
            }
        },
    );
});

describe('Change own password (#88)', () => {
    const row = PERMISSIONS.find((p) => p.label === 'Change own password');

    it('is shown for every role', () => {
        for (const role of ASSIGNABLE_ROLES) {
            expect(appPermissionsOf(role), role).toContain(row);
        }
    });

    // The dialog is in the profile menu of both layouts, so on every page:
    // the row names each role's home page, which that role always has.
    it.each(ASSIGNABLE_ROLES)("names %s's home page", (role) => {
        const home = homeRouteFor([role]).name;
        expect(home).not.toBe('Login');
        expect(row?.pages).toContain(home);
    });
});

describe('canOpenRoute', () => {
    it('needs the SELLER role itself on a seller-only route', () => {
        const meta = { sellerOnly: true, roles: [Role.Seller] };
        expect(canOpenRoute(meta, [Role.Seller])).toBe(true);
        expect(canOpenRoute(meta, [Role.Admin])).toBe(false);
        expect(canOpenRoute(meta, [Role.Admin, Role.Seller])).toBe(true);
    });

    it('lets ADMIN or a listed role open any other route', () => {
        const meta = { roles: [Role.Restocker] };
        expect(canOpenRoute(meta, [Role.Admin])).toBe(true);
        expect(canOpenRoute(meta, [Role.Restocker])).toBe(true);
        expect(canOpenRoute(meta, [Role.Adjuster])).toBe(false);
    });
});
