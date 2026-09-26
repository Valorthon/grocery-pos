import { Controller, ExecutionContext, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleGuard } from './role.guard';
import { Role } from '../types';
import { SalesController } from '../../sales/sales.controller';
import { AuthController } from '../auth.controller';
import { Public, RequireOwnRole, Roles } from '../auth.decorator';
import { ShiftController } from '../../shift/shift.controller';

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

    // Issue #84: an admin account also needs SELLER to sell.
    it('refuses an ADMIN-only account at the register, not an admin who sells', () => {
        expect(guard.canActivate(contextFor('sell', [Role.Admin]))).toBe(false);
        expect(
            guard.canActivate(contextFor('sell', [Role.Admin, Role.Seller])),
        ).toBe(true);
    });

    it.each<Handler>(['getAll', 'getDetails'])(
        'still lets an ADMIN-only account read sales through %s',
        (handler) => {
            expect(guard.canActivate(contextFor(handler, [Role.Admin]))).toBe(
                true,
            );
        },
    );
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

describe('RoleGuard on the shift routes (issue #84)', () => {
    const guard = new RoleGuard(new Reflector());

    function shiftContext(
        handler: keyof ShiftController,
        roles: Role[],
    ): ExecutionContext {
        return {
            switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
            getHandler: () => ShiftController.prototype[handler],
            getClass: () => ShiftController,
        } as unknown as ExecutionContext;
    }

    it.each<keyof ShiftController>([
        'open',
        'current',
        'drawer',
        'closeOwn',
        'lastClosed',
    ])('%s needs the SELLER role itself', (handler) => {
        expect(guard.canActivate(shiftContext(handler, [Role.Admin]))).toBe(
            false,
        );
        expect(guard.canActivate(shiftContext(handler, [Role.Seller]))).toBe(
            true,
        );
        expect(
            guard.canActivate(shiftContext(handler, [Role.Admin, Role.Seller])),
        ).toBe(true);
    });

    it.each<keyof ShiftController>(['list', 'getById', 'forceClose'])(
        '%s stays ADMIN-only, ADMIN alone enough',
        (handler) => {
            expect(guard.canActivate(shiftContext(handler, [Role.Admin]))).toBe(
                true,
            );
            expect(
                guard.canActivate(shiftContext(handler, [Role.Seller])),
            ).toBe(false);
        },
    );
});

describe('RoleGuard with @RequireOwnRole (issue #84)', () => {
    const guard = new RoleGuard(new Reflector());

    @RequireOwnRole(Role.Seller)
    @Controller('own')
    class OwnController {
        @Get('inherits')
        inherits(): void {}

        @Roles(Role.Admin)
        @Get('admin')
        adminOnly(): void {}

        @Roles(Role.Seller)
        @Get('bypass')
        bypass(): void {}

        @RequireOwnRole()
        @Get('empty')
        empty(): void {}
    }

    @Roles(Role.Seller)
    @Controller('mixed')
    class MixedController {
        @RequireOwnRole(Role.Seller, Role.Restocker)
        @Get('own')
        own(): void {}

        @Get('plain')
        plain(): void {}
    }

    function probe(
        controller: object,
        handler: () => void,
        roles: Role[],
    ): ExecutionContext {
        return {
            switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
            getHandler: () => handler,
            getClass: () => controller,
        } as unknown as ExecutionContext;
    }

    const can = (controller: object, handler: () => void, ...roles: Role[]) =>
        guard.canActivate(probe(controller, handler, roles));

    it('refuses ADMIN alone on a class-level @RequireOwnRole', () => {
        const h = OwnController.prototype.inherits;
        expect(can(OwnController, h, Role.Admin)).toBe(false);
        expect(can(OwnController, h, Role.Admin, Role.UserManager)).toBe(false);
        expect(can(OwnController, h, Role.Seller)).toBe(true);
        expect(can(OwnController, h, Role.Admin, Role.Seller)).toBe(true);
        expect(can(OwnController, h, Role.Restocker)).toBe(false);
    });

    it('lets a handler @Roles replace it, bypass and all', () => {
        expect(
            can(OwnController, OwnController.prototype.adminOnly, Role.Admin),
        ).toBe(true);
        expect(
            can(OwnController, OwnController.prototype.adminOnly, Role.Seller),
        ).toBe(false);
        expect(
            can(OwnController, OwnController.prototype.bypass, Role.Admin),
        ).toBe(true);
    });

    it('lets a handler @RequireOwnRole replace a class @Roles', () => {
        const own = MixedController.prototype.own;
        expect(can(MixedController, own, Role.Admin)).toBe(false);
        expect(can(MixedController, own, Role.Restocker)).toBe(true);
        expect(can(MixedController, own, Role.Seller)).toBe(true);
        expect(
            can(MixedController, MixedController.prototype.plain, Role.Admin),
        ).toBe(true);
    });

    it('fails closed on an empty @RequireOwnRole(), ADMIN included', () => {
        const h = OwnController.prototype.empty;
        const everyRole = [
            Role.Seller,
            Role.Adjuster,
            Role.Restocker,
            Role.UserManager,
            Role.Admin,
        ];
        for (const roles of [[Role.Admin], [Role.Seller], everyRole]) {
            expect(can(OwnController, h, ...roles)).toBe(false);
        }
    });
});
