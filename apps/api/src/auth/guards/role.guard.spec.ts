import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleGuard } from './role.guard';
import { Role } from '../types';
import { SalesController } from '../../sales/sales.controller';
import { AuthController } from '../auth.controller';

type Handler = keyof SalesController;

function contextFor(handler: Handler, roles: Role[]): ExecutionContext {
    return {
        switchToHttp: () => ({
            getRequest: () => ({ user: { roles } }),
        }),
        getHandler: () => SalesController.prototype[handler],
        getClass: () => SalesController,
    } as unknown as ExecutionContext;
}

describe('RoleGuard on the sales routes', () => {
    const guard = new RoleGuard(new Reflector());

    it.each<Handler>(['voidSale', 'refundSale'])(
        'lets only an admin reach %s',
        (handler) => {
            expect(guard.canActivate(contextFor(handler, [Role.Seller]))).toBe(
                false,
            );
            expect(
                guard.canActivate(
                    contextFor(handler, [Role.Adjuster, Role.UserManager]),
                ),
            ).toBe(false);
            expect(guard.canActivate(contextFor(handler, [Role.Admin]))).toBe(
                true,
            );
        },
    );

    it('still lets a seller ring up a sale', () => {
        expect(guard.canActivate(contextFor('sell', [Role.Seller]))).toBe(true);
    });
});

describe('RoleGuard on the public auth routes', () => {
    const guard = new RoleGuard(new Reflector());

    function authContext(
        handler: keyof AuthController,
        user: { roles: unknown } | undefined,
    ): ExecutionContext {
        return {
            switchToHttp: () => ({ getRequest: () => ({ user }) }),
            getHandler: () => AuthController.prototype[handler],
            getClass: () => AuthController,
        } as unknown as ExecutionContext;
    }

    // Previously @Roles(Role.Unauthenticated) made these 403 for anyone
    // still holding a valid JWT unless they were ADMIN (issue #32).
    it.each<keyof AuthController>(['login', 'refresh', 'logout'])(
        'lets a signed-in non-admin call %s',
        (handler) => {
            for (const roles of [
                [Role.Seller],
                [Role.Adjuster, Role.Restocker],
                [Role.UserManager],
                [Role.Admin],
            ]) {
                expect(guard.canActivate(authContext(handler, { roles }))).toBe(
                    true,
                );
            }
        },
    );

    it.each<keyof AuthController>(['login', 'refresh', 'logout'])(
        'lets an anonymous caller call %s',
        (handler) => {
            expect(
                guard.canActivate(
                    authContext(handler, { roles: Role.Unauthenticated }),
                ),
            ).toBe(true);
        },
    );
});
