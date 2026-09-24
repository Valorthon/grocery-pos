import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleGuard } from './role.guard';
import { Role } from '../types';
import { SalesController } from '../../sales/sales.controller';

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
