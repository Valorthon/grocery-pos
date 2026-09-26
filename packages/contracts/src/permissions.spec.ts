import { describe, expect, it } from 'vitest';
import { PERMISSIONS, appPermissionsOf, permissionsOf } from './permissions.js';
import { ASSIGNABLE_ROLES, Role } from './roles.js';

describe('permissionsOf', () => {
    it('gives ADMIN every permission, in table order', () => {
        expect(permissionsOf(Role.Admin)).toEqual([...PERMISSIONS]);
    });

    it('gives other roles only rows that name them', () => {
        for (const role of ASSIGNABLE_ROLES.filter((r) => r !== Role.Admin)) {
            for (const p of permissionsOf(role)) {
                expect(p.roles).toContain(role);
            }
        }
    });

    it('leaves an ADJUSTER stock adjustments, not adding or editing products (#83)', () => {
        const labels = permissionsOf(Role.Adjuster).map((p) => p.label);
        expect(labels).toContain('Create and view adjustments');
        expect(labels).toContain('Look up products');
        expect(labels).not.toContain('Add products');
        expect(labels).not.toContain('Edit product details (not price)');
        const restocker = permissionsOf(Role.Restocker).map((p) => p.label);
        expect(restocker).toContain('Add products');
        expect(restocker).toContain('Edit product details (not price)');
    });

    it('gives the anonymous placeholder nothing', () => {
        expect(permissionsOf(Role.Unauthenticated)).toEqual([]);
    });
});

describe('appPermissionsOf', () => {
    it('is a subset of permissionsOf that honours appRoles', () => {
        for (const role of ASSIGNABLE_ROLES) {
            const server = permissionsOf(role);
            for (const p of appPermissionsOf(role)) {
                expect(server).toContain(p);
                if (p.appRoles) expect(p.appRoles).toContain(role);
            }
        }
    });

    it('hides rows with an empty appRoles (no screen yet)', () => {
        const hidden = PERMISSIONS.filter((p) => p.appRoles?.length === 0);
        expect(hidden.length).toBeGreaterThan(0);
        for (const role of ASSIGNABLE_ROLES) {
            for (const p of hidden) {
                expect(appPermissionsOf(role)).not.toContain(p);
            }
        }
    });
});
