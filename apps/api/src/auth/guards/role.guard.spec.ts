import { Controller, ExecutionContext, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleGuard } from './role.guard';
import { Role } from '../types';
import { SalesController } from '../../sales/sales.controller';
import { AuthController } from '../auth.controller';
import { Public, Roles } from '../auth.decorator';

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
                    authContext(handler, { roles: [Role.Unauthenticated] }),
                ),
            ).toBe(true);
        },
    );
});

describe('RoleGuard with the anonymous user of a public route', () => {
    const guard = new RoleGuard(new Reflector());

    it('never lets it through a role check', () => {
        const ctx = {
            switchToHttp: () => ({
                getRequest: () => ({ user: { roles: [Role.Unauthenticated] } }),
            }),
            getHandler: () => SalesController.prototype.sell,
            getClass: () => SalesController,
        } as unknown as ExecutionContext;

        expect(guard.canActivate(ctx)).toBe(false);
    });
});

describe('RoleGuard without a user on the request', () => {
    const guard = new RoleGuard(new Reflector());

    it('refuses a role-checked route instead of throwing', () => {
        // JWTAuthGuard runs first and normally sets `user`; if it ever
        // did not, the role check must fail closed, not crash into a 500
        // or let the request through.
        const ctx = {
            switchToHttp: () => ({ getRequest: () => ({}) }),
            getHandler: () => SalesController.prototype.sell,
            getClass: () => SalesController,
        } as unknown as ExecutionContext;

        expect(guard.canActivate(ctx)).toBe(false);
    });

    it('still lets a public route through', () => {
        const ctx = {
            switchToHttp: () => ({ getRequest: () => ({}) }),
            getHandler: () => AuthController.prototype.login,
            getClass: () => AuthController,
        } as unknown as ExecutionContext;

        expect(guard.canActivate(ctx)).toBe(true);
    });
});

describe('RoleGuard fails closed without roles (issue #61)', () => {
    const guard = new RoleGuard(new Reflector());

    @Controller('probe')
    class ProbeController {
        @Get('none')
        noRoles(): void {}

        @Roles()
        @Get('empty')
        emptyRoles(): void {}

        @Public()
        @Get('open')
        open(): void {}

        @Roles(Role.Seller)
        @Get('seller')
        seller(): void {}
    }

    @Roles()
    @Controller('empty-class')
    class EmptyClassController {
        @Get()
        inherits(): void {}
    }

    function probe(
        controller: object,
        handler: () => void,
        user: { roles: Role[] } | undefined,
    ): ExecutionContext {
        return {
            switchToHttp: () => ({ getRequest: () => ({ user }) }),
            getHandler: () => handler,
            getClass: () => controller,
        } as unknown as ExecutionContext;
    }

    const everyone: Role[][] = [
        [Role.Seller],
        [Role.UserManager],
        [Role.Adjuster, Role.Restocker],
        [Role.Admin],
    ];

    it.each(everyone)(
        'refuses a route with no @Roles metadata (%s)',
        (...roles) => {
            const ctx = probe(
                ProbeController,
                ProbeController.prototype.noRoles,
                { roles },
            );
            expect(guard.canActivate(ctx)).toBe(false);
        },
    );

    it.each(everyone)(
        'refuses a route with an empty @Roles() (%s)',
        (...roles) => {
            expect(
                guard.canActivate(
                    probe(
                        ProbeController,
                        ProbeController.prototype.emptyRoles,
                        {
                            roles,
                        },
                    ),
                ),
            ).toBe(false);
            expect(
                guard.canActivate(
                    probe(
                        EmptyClassController,
                        EmptyClassController.prototype.inherits,
                        { roles },
                    ),
                ),
            ).toBe(false);
        },
    );

    it('still lets a @Public() route through, signed in or not', () => {
        const handler = ProbeController.prototype.open;
        expect(
            guard.canActivate(probe(ProbeController, handler, undefined)),
        ).toBe(true);
        expect(
            guard.canActivate(
                probe(ProbeController, handler, { roles: [Role.Seller] }),
            ),
        ).toBe(true);
    });

    it('still checks a route that names its roles', () => {
        const handler = ProbeController.prototype.seller;
        expect(
            guard.canActivate(
                probe(ProbeController, handler, { roles: [Role.Seller] }),
            ),
        ).toBe(true);
        expect(
            guard.canActivate(
                probe(ProbeController, handler, { roles: [Role.Restocker] }),
            ),
        ).toBe(false);
    });
});
