import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, Get } from '@nestjs/common';
import { IS_PUBLIC_KEY, Public, ROLES_KEY, Roles } from './auth.decorator';
import { Role } from './types';

type Ctor = { name: string; prototype: object };

/** Every `*.controller.ts` under src/, loaded for its decorator metadata. */
function allControllers(dir = join(__dirname, '..')): Ctor[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return allControllers(path);
        if (!entry.name.endsWith('.controller.ts')) return [];
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const exported = require(path) as Record<string, unknown>;
        return Object.values(exported).filter(
            (value): value is Ctor =>
                typeof value === 'function' &&
                Reflect.hasMetadata('path', value),
        );
    });
}

function has(key: string, target: object): boolean {
    const value: unknown = Reflect.getMetadata(key, target);
    return Array.isArray(value) ? value.length > 0 : !!value;
}

/**
 * `Class.method` for each route that is both @Public() and @Roles(...),
 * whether either decorator sits on the class or on the handler. RoleGuard
 * skips public routes, so such a @Roles would silently do nothing.
 */
function publicRoutesWithRoles(controllers: Ctor[]): string[] {
    return controllers.flatMap((ctrl) =>
        Object.getOwnPropertyNames(ctrl.prototype)
            .filter((name) => name !== 'constructor')
            .filter((name) => {
                const handler = (ctrl.prototype as Record<string, object>)[
                    name
                ];
                const isPublic =
                    has(IS_PUBLIC_KEY, handler) || has(IS_PUBLIC_KEY, ctrl);
                const hasRoles =
                    has(ROLES_KEY, handler) || has(ROLES_KEY, ctrl);
                return isPublic && hasRoles;
            })
            .map((name) => `${ctrl.name}.${name}`),
    );
}

describe('@Public() and @Roles()', () => {
    it('are never combined on a route', () => {
        const controllers = allControllers();

        expect(controllers.map((c) => c.name)).toEqual(
            expect.arrayContaining(['AuthController', 'HealthController']),
        );
        expect(publicRoutesWithRoles(controllers)).toEqual([]);
    });

    it('the check catches a combination on the handler or the class', () => {
        @Controller('a')
        class HandlerLevel {
            @Public()
            @Roles(Role.Seller)
            @Get()
            both() {}
        }

        @Public()
        @Controller('b')
        class ClassLevel {
            @Roles(Role.Admin)
            @Get()
            guarded() {}

            @Get()
            open() {}
        }

        expect(publicRoutesWithRoles([HandlerLevel, ClassLevel])).toEqual([
            'HandlerLevel.both',
            'ClassLevel.guarded',
        ]);
    });
});
