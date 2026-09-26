import { describe, expect, it } from 'vitest';
import {
    ASSIGNABLE_ROLES,
    Role,
    canGrantRole,
    canManageUser,
    holdsRole,
} from './roles.js';

describe('holdsRole', () => {
    it('is true for a held role, and for ADMIN whatever the role', () => {
        expect(holdsRole([Role.Seller], Role.Seller)).toBe(true);
        expect(holdsRole([Role.Seller], Role.Restocker)).toBe(false);
        expect(holdsRole([Role.Admin], Role.Restocker)).toBe(true);
    });
});

describe('canGrantRole', () => {
    it('lets an ADMIN grant every assignable role, never Unauthenticated', () => {
        for (const role of ASSIGNABLE_ROLES) {
            expect(canGrantRole([Role.Admin], role)).toBe(true);
        }
        expect(canGrantRole([Role.Admin], Role.Unauthenticated)).toBe(false);
    });

    it('lets a USER_MANAGER grant SELLER, ADJUSTER and RESTOCKER only', () => {
        const um = [Role.UserManager];
        expect(canGrantRole(um, Role.Seller)).toBe(true);
        expect(canGrantRole(um, Role.Adjuster)).toBe(true);
        expect(canGrantRole(um, Role.Restocker)).toBe(true);
        expect(canGrantRole(um, Role.UserManager)).toBe(false);
        expect(canGrantRole(um, Role.Admin)).toBe(false);
    });

    it('lets nobody else grant anything', () => {
        expect(canGrantRole([Role.Seller], Role.Seller)).toBe(false);
    });
});

describe('canManageUser', () => {
    it('lets an ADMIN manage anyone', () => {
        expect(canManageUser([Role.Admin], [Role.Admin])).toBe(true);
    });

    it('lets a USER_MANAGER manage only users whose roles are all manageable', () => {
        const um = [Role.UserManager];
        expect(canManageUser(um, [Role.Seller, Role.Restocker])).toBe(true);
        expect(canManageUser(um, [Role.Seller, Role.UserManager])).toBe(false);
        expect(canManageUser(um, [Role.Admin])).toBe(false);
    });

    it('lets a plain SELLER manage nobody', () => {
        expect(canManageUser([Role.Seller], [Role.Seller])).toBe(false);
    });
});
