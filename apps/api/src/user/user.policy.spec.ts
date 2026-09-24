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

    it('lets a manager grant only roles they hold', () => {
        expect(
            denied(() => assertCanGrant(MANAGER.roles, [Role.UserManager])),
        ).toBeNull();
        expect(
            denied(() => assertCanGrant(MANAGER.roles, [Role.Admin])),
        ).toEqual(forbidden(ErrorCode.USER_ROLE_NOT_GRANTABLE));
        expect(
            denied(() => assertCanGrant(MANAGER.roles, [Role.Seller])),
        ).toEqual(forbidden(ErrorCode.USER_ROLE_NOT_GRANTABLE));
    });

    it('lets a manager who also sells grant SELLER', () => {
        expect(
            denied(() =>
                assertCanGrant(
                    [Role.UserManager, Role.Seller],
                    [Role.Seller, Role.UserManager],
                ),
            ),
        ).toBeNull();
    });
});

describe('assertCanUpdate', () => {
    const check = (actor: PolicyUser, target: PolicyUser, change: UserChange) =>
        denied(() => assertCanUpdate(actor, target, change));

    describe('rule 1: granting', () => {
        it('refuses a manager promoting someone to ADMIN', () => {
            expect(
                check(MANAGER, MANAGER2, {
                    roles: [Role.UserManager, Role.Admin],
                }),
            ).toEqual(forbidden(ErrorCode.USER_ROLE_NOT_GRANTABLE));
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

        it('refuses a manager touching a user with roles they lack', () => {
            expect(check(MANAGER, CASHIER, { isActive: false })).toEqual(
                forbidden(ErrorCode.USER_TARGET_FORBIDDEN),
            );
        });

        it('lets a manager manage a fellow manager', () => {
            expect(check(MANAGER, MANAGER2, { isActive: false })).toBeNull();
        });

        it('lets an admin touch another admin', () => {
            expect(check(ADMIN, ADMIN2, { isActive: false })).toBeNull();
        });
    });

    describe("rule 4: other users' passwords", () => {
        it('lets only an admin reset one', () => {
            expect(check(ADMIN, CASHIER, { password: 'new' })).toBeNull();
            expect(check(ADMIN, ADMIN2, { password: 'new' })).toBeNull();
            expect(check(MANAGER, MANAGER2, { password: 'new' })).toEqual(
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
