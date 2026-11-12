import { describe, expect, it } from 'vitest';
import { ASSIGNABLE_ROLES, Role } from '@grocery-pos/contracts';
import { ROLE_LOOK, roleLabel, type AssignableRole } from './role-look';

describe('role look (#297)', () => {
    it('gives every assignable role a label, icon and description', () => {
        for (const role of ASSIGNABLE_ROLES) {
            const look = ROLE_LOOK[role as AssignableRole];
            expect(look.label).toBeTruthy();
            expect(look.icon).toBeTruthy();
            expect(look.description).toBeTruthy();
        }
        expect(Object.keys(ROLE_LOOK).sort()).toEqual(
            [...ASSIGNABLE_ROLES].sort(),
        );
    });

    it('names roles by their friendly label', () => {
        expect(roleLabel(Role.UserManager)).toBe('User manager');
        expect(roleLabel(Role.Unauthenticated)).toBe(Role.Unauthenticated);
    });
});
