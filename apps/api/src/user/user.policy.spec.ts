import { Role } from '../auth/types';
import { AppError, ErrorCode } from '../common/errors';
import {
    assertCanGrant,
    assertCanUpdate,
    PolicyUser,
    removesActiveAdmin,
    UserChange,
} from './user.policy';

const user = (id: string, ...roles: Role[]): PolicyUser => ({
    id,
    roles,
    isActive: true,
});

const ADMIN = user('admin', Role.Admin);
const ADMIN2 = user('admin2', Role.Admin);
const MANAGER = user('manager', Role.UserManager);
const MANAGER2 = user('manager2', Role.UserManager);
const CASHIER = user('cashier', Role.Seller);
const STOCKER = user('stocker', Role.Restocker, Role.Adjuster);

function denied(fn: () => void): { status: number; code: string } | null {
    try {
        fn();
        return null;
    } catch (err) {
        const e = err as AppError;
        return { status: e.statusCode, code: e.code };
    }
}

const forbidden = (code: ErrorCode) => ({ status: 403, code });

describe('assertCanGrant (rule 1)', () => {
    it('lets an admin grant anything', () => {
        expect(
            denied(() =>
                assertCanGrant(ADMIN.roles, [Role.Admin, Role.UserManager]),
            ),
        ).toBeNull();
    });

    it('lets a manager grant SELLER, ADJUSTER and RESTOCKER', () => {
        expect(
            denied(() =>
                assertCanGrant(MANAGER.roles, [
                    Role.Seller,
                    Role.Adjuster,
                    Role.Restocker,
                ]),
            ),
        ).toBeNull();
    });

    it.each([Role.Admin, Role.UserManager])(
        'refuses a manager granting %s',
        (role) => {
            expect(denied(() => assertCanGrant(MANAGER.roles, [role]))).toEqual(
                forbidden(ErrorCode.USER_ROLE_NOT_GRANTABLE),
            );
        },
    );

    it('refuses anyone without USER_MANAGER or ADMIN', () => {
        expect(
            denied(() => assertCanGrant(STOCKER.roles, [Role.Restocker])),
        ).toEqual(forbidden(ErrorCode.USER_ROLE_NOT_GRANTABLE));
    });
});

describe('assertCanUpdate', () => {
    const check = (actor: PolicyUser, target: PolicyUser, change: UserChange) =>
        denied(() => assertCanUpdate(actor, target, change));

    describe('rule 1: granting', () => {
        it.each([Role.Admin, Role.UserManager])(
            'refuses a manager promoting a cashier to %s',
            (role) => {
                expect(
                    check(MANAGER, CASHIER, { roles: [Role.Seller, role] }),
                ).toEqual(forbidden(ErrorCode.USER_ROLE_NOT_GRANTABLE));
            },
        );

        it('lets a manager move a cashier between staff roles', () => {
            expect(
                check(MANAGER, CASHIER, {
                    roles: [Role.Adjuster, Role.Restocker],
                }),
            ).toBeNull();
        });

        it('lets an admin promote anyone', () => {
            expect(check(ADMIN, CASHIER, { roles: [Role.Admin] })).toBeNull();
        });
    });

    describe('rule 2: own roles', () => {
        it('refuses a manager escalating themselves (the issue repro)', () => {
            expect(check(MANAGER, MANAGER, { roles: [Role.Admin] })).toEqual(
                forbidden(ErrorCode.USER_SELF_ROLE_CHANGE),
            );
        });

        it('refuses an admin demoting themselves', () => {
            expect(check(ADMIN, ADMIN, { roles: [Role.Seller] })).toEqual(
                forbidden(ErrorCode.USER_SELF_ROLE_CHANGE),
            );
        });

        it('treats resending the same roles as no change', () => {
            // The edit form always sends roles along with isActive.
            expect(
                check(STOCKER, STOCKER, {
                    roles: [Role.Adjuster, Role.Restocker],
                }),
            ).toBeNull();
            expect(
                check(MANAGER, MANAGER, {
                    roles: [Role.UserManager],
                    name: 'boss',
                }),
            ).toBeNull();
        });
    });

    describe('rule 3: targeting', () => {
        it.each<[string, UserChange]>([
            ['name', { name: 'pwned' }],
            ['roles', { roles: [Role.Seller] }],
            ['password', { password: 'hunter2' }],
            ['isActive', { isActive: false }],
            ['nothing', {}],
        ])("refuses a manager touching an admin's %s", (_field, change) => {
            expect(check(MANAGER, ADMIN, change)).toEqual(
                forbidden(ErrorCode.USER_TARGET_FORBIDDEN),
            );
        });

        it.each<[string, UserChange]>([
            ['name', { name: 'x' }],
            ['roles', { roles: [Role.Seller] }],
            ['isActive', { isActive: false }],
        ])("refuses a manager touching another manager's %s", (_f, change) => {
            expect(check(MANAGER, MANAGER2, change)).toEqual(
                forbidden(ErrorCode.USER_TARGET_FORBIDDEN),
            );
        });

        it('refuses a manager touching a staff member who also manages', () => {
            const lead = user('lead', Role.Seller, Role.UserManager);
            expect(check(MANAGER, lead, { isActive: false })).toEqual(
                forbidden(ErrorCode.USER_TARGET_FORBIDDEN),
            );
        });

        it.each<[string, UserChange]>([
            ['rename', { name: 'till2' }],
            ['deactivate', { isActive: false }],
            ['re-role', { roles: [Role.Restocker] }],
        ])('lets a manager %s a cashier or stocker', (_label, change) => {
            expect(check(MANAGER, CASHIER, change)).toBeNull();
            expect(check(MANAGER, STOCKER, change)).toBeNull();
        });

        it('lets a manager rename themselves', () => {
            // The edit form sends the unchanged isActive along with the name.
            expect(
                check(MANAGER, MANAGER, { name: 'boss', isActive: true }),
            ).toBeNull();
            // A rename sent on its own (no isActive) is allowed too.
            expect(check(MANAGER, MANAGER, { name: 'boss' })).toBeNull();
        });

        it('lets an admin touch another admin', () => {
            expect(check(ADMIN, ADMIN2, { isActive: false })).toBeNull();
        });

        it('refuses a non-manager outright', () => {
            expect(check(STOCKER, CASHIER, { name: 'x' })).toEqual(
                forbidden(ErrorCode.USER_TARGET_FORBIDDEN),
            );
        });
    });

    describe("rule 4: other users' passwords", () => {
        it('lets only an admin reset one', () => {
            expect(check(ADMIN, CASHIER, { password: 'new' })).toBeNull();
            expect(check(ADMIN, ADMIN2, { password: 'new' })).toBeNull();
            expect(check(MANAGER, CASHIER, { password: 'new' })).toEqual(
                forbidden(ErrorCode.USER_PASSWORD_RESET_FORBIDDEN),
            );
        });

        it('sends everyone, admin included, to /me/password for their own', () => {
            expect(check(ADMIN, ADMIN, { password: 'new' })).toEqual(
                forbidden(ErrorCode.USER_PASSWORD_RESET_FORBIDDEN),
            );
            expect(check(MANAGER, MANAGER, { password: 'new' })).toEqual(
                forbidden(ErrorCode.USER_PASSWORD_RESET_FORBIDDEN),
            );
        });
    });
    describe('rule 6: self-deactivation (issue #61)', () => {
        it('refuses a manager deactivating themselves', () => {
            expect(check(MANAGER, MANAGER, { isActive: false })).toEqual(
                forbidden(ErrorCode.USER_SELF_DEACTIVATE),
            );
            expect(
                check(MANAGER, MANAGER, { name: 'boss', isActive: false }),
            ).toEqual(forbidden(ErrorCode.USER_SELF_DEACTIVATE));
        });

        it('refuses a staff member who also manages deactivating themselves', () => {
            const lead = user('lead', Role.Seller, Role.UserManager);
            expect(check(lead, lead, { isActive: false })).toEqual(
                forbidden(ErrorCode.USER_SELF_DEACTIVATE),
            );
        });

        it('leaves an admin deactivating themselves to the last-admin check', () => {
            expect(check(ADMIN, ADMIN, { isActive: false })).toBeNull();
            const both = user('both', Role.Admin, Role.UserManager);
            expect(check(both, both, { isActive: false })).toBeNull();
        });

        it('still lets a manager deactivate a cashier', () => {
            expect(check(MANAGER, CASHIER, { isActive: false })).toBeNull();
        });
    });
});

describe('removesActiveAdmin (rule 5 trigger)', () => {
    it('flags deactivating or demoting an active admin', () => {
        expect(removesActiveAdmin(ADMIN, { isActive: false })).toBe(true);
        expect(removesActiveAdmin(ADMIN, { roles: [Role.Seller] })).toBe(true);
    });

    it('ignores changes that keep the admin, and non-admins', () => {
        expect(removesActiveAdmin(ADMIN, { roles: [Role.Admin] })).toBe(false);
        expect(removesActiveAdmin(ADMIN, { name: 'x' })).toBe(false);
        expect(removesActiveAdmin(CASHIER, { isActive: false })).toBe(false);
        expect(
            removesActiveAdmin(
                { ...ADMIN, isActive: false },
                { roles: [Role.Seller] },
            ),
        ).toBe(false);
    });
});
