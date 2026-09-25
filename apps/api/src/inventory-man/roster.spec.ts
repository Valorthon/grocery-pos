/**
 * `GET /adjustments/users` and `GET /restocks/users` (issue #12): the
 * "adjusted by" / "restocked by" filter lists of the history views. Only the
 * roles that open those views may call them, and they return `_id` and
 * `name` only.
 */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleGuard } from '../auth/guards/role.guard';
import { Role } from '../auth/types';
import { AdjustmentController } from './adjustment/adjustment.controller';
import { AdjustmentService } from './adjustment/adjustment.service';
import { RestockController } from './restock/restock.controller';
import { RestockService } from './restock/restock.service';

type Ctor = { prototype: object };

function canCall(controller: Ctor, handler: string, roles: Role[]): boolean {
    const ctx = {
        switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
        getHandler: () =>
            (controller.prototype as Record<string, unknown>)[handler],
        getClass: () => controller,
    } as unknown as ExecutionContext;
    return new RoleGuard(new Reflector()).canActivate(ctx) as boolean;
}

/** Captures the aggregation pipeline a service runs. */
function captureAggregate() {
    const aggregate = jest.fn<Promise<unknown[]>, [unknown[]]>();
    aggregate.mockResolvedValue([]);
    return { model: { aggregate }, pipeline: () => aggregate.mock.calls[0][0] };
}

const OTHER_ROLES = (allowed: Role) =>
    [Role.Seller, Role.Adjuster, Role.Restocker, Role.UserManager]
        .filter((role) => role !== allowed)
        .map((role) => [role]);

describe.each([
    {
        path: '/adjustments/users',
        controller: AdjustmentController,
        handler: 'getAdjustUsers',
        role: Role.Adjuster,
        call: async (model: object) => {
            const service = new (
                AdjustmentService as unknown as new (
                    ...args: unknown[]
                ) => AdjustmentService
            )(undefined, model);
            return service.getAdjustUsers();
        },
    },
    {
        path: '/restocks/users',
        controller: RestockController,
        handler: 'getRestockUsers',
        role: Role.Restocker,
        call: async (model: object) => {
            const service = new (
                RestockService as unknown as new (
                    ...args: unknown[]
                ) => RestockService
            )(undefined, model);
            return service.getRestockUsers();
        },
    },
])('GET $path', ({ controller, handler, role, call }) => {
    it(`is open to ${role} and ADMIN`, () => {
        expect(canCall(controller, handler, [role])).toBe(true);
        expect(canCall(controller, handler, [Role.Admin])).toBe(true);
    });

    it.each(OTHER_ROLES(role))('is closed to %s', (other) => {
        expect(canCall(controller, handler, [other])).toBe(false);
    });

    it('is closed to an anonymous caller', () => {
        expect(canCall(controller, handler, [Role.Unauthenticated])).toBe(
            false,
        );
    });

    it('reads only the name from users and returns only _id and name', async () => {
        const { model, pipeline } = captureAggregate();

        await call(model);

        const stages = pipeline() as Record<string, Record<string, unknown>>[];
        const lookup = stages.find((stage) => '$lookup' in stage)!.$lookup;
        expect(lookup.pipeline).toEqual([{ $project: { name: 1 } }]);

        const last = stages[stages.length - 1];
        expect(Object.keys(last.$project).sort()).toEqual(['_id', 'name']);
    });
});
