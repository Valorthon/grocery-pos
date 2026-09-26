/**
 * Every route states who may call it (issues #13, #61).
 *
 * RoleGuard fails closed: a route that is not `@Public()` and whose
 * effective `@Roles()` list is empty or missing is refused for everyone
 * (403). This spec makes that a build failure instead of a dead route. It
 * finds the controllers the way Nest does, by walking AppModule's module
 * metadata (`common/testing/app-routes.ts`), checks inherited handlers
 * too, and fails if any handler that is not `@Public()` ends up with no
 * explicit role list. "Any signed-in user" is written
 * `@Roles(...ASSIGNABLE_ROLES)`. `@RequireOwnRole(...)` (#84) counts as a
 * role list too; it only stops ADMIN passing on its own.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, Get, Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    ADMIN_BYPASS_KEY,
    IS_PUBLIC_KEY,
    ROLES_KEY,
    Roles,
} from '../auth/auth.decorator';
import { Role } from '../auth/types';
import {
    appControllers,
    controllersOf,
    handlersOf,
    type Controller as Ctor,
} from './testing/app-routes';

// AppModule's TypedConfigModule validates the environment as soon as it
// is imported (ConfigModule.forRoot), and a unit run has no .env. It
// registers no controllers, so an empty stand-in changes nothing here.
jest.mock('./typed-config/typed-config.module', () => ({
    TypedConfigModule: class TypedConfigModule {},
}));

const SRC = join(__dirname, '..');
const reflector = new Reflector();

const routes = appControllers().flatMap((controller) =>
    handlersOf(controller).map(([name, handler]) => {
        const targets = [handler, controller];
        return {
            label: `${controller.name}.${name}`,
            isPublic:
                reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ===
                true,
            roles: reflector.getAllAndOverride<Role[] | undefined>(
                ROLES_KEY,
                targets,
            ),
            ownRoles: Reflect.getMetadata(ROLES_KEY, handler) as
                Role[] | undefined,
            classRoles: Reflect.getMetadata(ROLES_KEY, controller) as
                Role[] | undefined,
            // Set wherever the roles are, so a handler's @Roles or
            // @RequireOwnRole replaces the class's for both (#84).
            bypassWithRoles:
                Reflect.hasMetadata(ADMIN_BYPASS_KEY, handler) ===
                    Reflect.hasMetadata(ROLES_KEY, handler) &&
                Reflect.hasMetadata(ADMIN_BYPASS_KEY, controller) ===
                    Reflect.hasMetadata(ROLES_KEY, controller),
        };
    }),
);

/**
 * Classes decorated with `@Controller()` in any non-test source file that
 * mentions the decorator, whatever the file is called. The module walk
 * must find each one, so a controller cannot slip past this spec.
 */
function controllersOnDisk(dir = SRC): Ctor[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            return entry.name === 'testing' ? [] : controllersOnDisk(path);
        }
        if (!/\.ts$/.test(entry.name) || /\.(spec|d)\.ts$/.test(entry.name))
            return [];
        if (!readFileSync(path, 'utf8').includes('@Controller(')) return [];
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const exported = require(path) as Record<string, unknown>;
        return Object.values(exported).filter(
            (value): value is Ctor =>
                typeof value === 'function' &&
                Reflect.getMetadata('__controller__', value) === true,
        );
    });
}

describe('Route role declarations', () => {
    it('finds every controller the app serves', () => {
        const served = appControllers();
        const onDisk = controllersOnDisk();

        expect(onDisk.length).toBeGreaterThan(0);
        expect(served.map((c) => c.name).sort()).toEqual(
            onDisk.map((c) => c.name).sort(),
        );
        expect(routes.map((r) => r.label)).toEqual(
            expect.arrayContaining([
                'AuthController.login',
                'DashboardController.getDashboard',
                'HealthController.checkLiveness',
                'SalesController.getAll',
                'ProductController.update',
                'UserController.getProfile',
            ]),
        );
    });

    it.each(routes.map((r) => [r.label, r] as const))(
        '%s declares its roles',
        (_label, route) => {
            // An empty @Roles() on the handler or the class is never a
            // decision; it means "anyone signed in" by accident.
            expect(route.ownRoles ?? ['unset']).not.toHaveLength(0);
            expect(route.classRoles ?? ['unset']).not.toHaveLength(0);
            // Roles come from @Roles or @RequireOwnRole, never a bare
            // SetMetadata that leaves ADMIN's bypass to the class.
            expect(route.bypassWithRoles).toBe(true);

            if (route.isPublic) return;
            expect(route.roles?.length ?? 0).toBeGreaterThan(0);
        },
    );
});

describe('Route discovery (app-routes.ts)', () => {
    @Controller('base')
    class BaseController {
        @Roles(Role.Admin)
        @Get('a')
        inherited(): void {}

        @Roles(Role.Admin)
        @Get('b')
        overridden(): void {}
    }

    @Controller('child')
    class ChildController extends BaseController {
        @Roles(Role.Seller)
        @Get('c')
        own(): void {}

        // An undecorated override is not a route in Nest either.
        override overridden(): void {}
    }

    @Module({ controllers: [ChildController] })
    class LeafModule {}

    @Module({})
    class DynamicHost {}

    @Module({
        imports: [
            { forwardRef: () => LeafModule },
            {
                module: DynamicHost,
                controllers: [BaseController],
            },
        ],
    })
    class RootModule {}

    it('walks static, forward-ref and dynamic imports', () => {
        expect(
            controllersOf(RootModule)
                .map((c) => c.name)
                .sort(),
        ).toEqual(['BaseController', 'ChildController']);
    });

    it('checks inherited handlers and honours overrides', () => {
        expect(
            handlersOf(ChildController)
                .map(([name]) => name)
                .sort(),
        ).toEqual(['inherited', 'own']);
    });
});
