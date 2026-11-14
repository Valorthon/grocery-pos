import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleGuard } from './role.guard';
import { Role } from '../types';
import { SalesController } from '../../sales/sales.controller';
import { UserController } from '../../user/user.controller';
import { AuthController } from '../auth.controller';
import { ErrorCode } from '../../common/errors';

// #361: the bootstrap ADMIN's temporary password must be changed first.
type Target =
    typeof UserController | typeof SalesController | typeof AuthController;

function pending(
    target: Target,
    handler: string,
    mustChangePassword = true,
): ExecutionContext {
    return {
        switchToHttp: () => ({
            getRequest: () => ({
                user: { roles: [Role.Admin], mustChangePassword },
            }),
        }),
        getHandler: () =>
            (target.prototype as unknown as Record<string, unknown>)[handler],
        getClass: () => target,
    } as unknown as ExecutionContext;
}

describe('RoleGuard while a password change is required', () => {
    const guard = new RoleGuard(new Reflector());

    it.each(['getProfile', 'changeOwnPassword'])('allows %s', (handler) => {
        expect(guard.canActivate(pending(UserController, handler))).toBe(true);
    });

    it('allows public routes (refresh, logout)', () => {
        expect(guard.canActivate(pending(AuthController, 'logout'))).toBe(true);
    });

    it.each<[Target, string]>([
        [UserController, 'getAll'],
        [UserController, 'create'],
        [SalesController, 'getAll'],
        [AuthController, 'reauth'],
    ])('refuses %p.%s with a 403', (target, handler) => {
        expect(() => guard.canActivate(pending(target, handler))).toThrow(
            expect.objectContaining({
                code: ErrorCode.USER_PASSWORD_CHANGE_REQUIRED,
                statusCode: 403,
            }) as Error,
        );
    });

    it('lets the same routes through once the password is changed', () => {
        expect(
            guard.canActivate(pending(UserController, 'getAll', false)),
        ).toBe(true);
    });
});
