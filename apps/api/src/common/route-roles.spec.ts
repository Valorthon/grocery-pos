/**
 * Every route states who may call it (issue #13).
 *
 * RoleGuard lets any signed-in user through when a route's effective
 * `@Roles()` list is empty or missing, so an empty decorator (or a
 * forgotten one) silently opens a route to every role. This spec loads
 * every `*.controller.ts` under src/ and fails if any handler that is not
 * `@Public()` ends up with no explicit role list. "Any signed-in user" is
 * written `@Roles(...ASSIGNABLE_ROLES)`.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../auth/auth.decorator';
import { Role } from '../auth/types';

type Constructor = abstract new (...args: never[]) => unknown;
type Handler = (...args: unknown[]) => unknown;

const SRC = join(__dirname, '..');

function controllerFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return controllerFiles(path);
        return entry.name.endsWith('.controller.ts') ? [path] : [];
    });
}

/** Classes decorated with `@Controller()`. */
function controllersIn(file: string): Constructor[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exports = require(file) as Record<string, unknown>;
    return Object.values(exports).filter(
        (value): value is Constructor =>
            typeof value === 'function' &&
            Reflect.getMetadata('__controller__', value) === true,
    );
}

function handlersOf(controller: Constructor): Array<[string, Handler]> {
    const proto = controller.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(proto)
        .filter((name) => name !== 'constructor')
        .map((name) => [name, proto[name]] as [string, unknown])
        .filter(
            (entry): entry is [string, Handler] =>
                typeof entry[1] === 'function' &&
                // Only route handlers carry a request method.
                Reflect.getMetadata('method', entry[1]) !== undefined,
        );
}

const reflector = new Reflector();

const routes = controllerFiles(SRC).flatMap((file) =>
    controllersIn(file).flatMap((controller) =>
        handlersOf(controller).map(([name, handler]) => {
            const targets = [handler, controller];
            return {
                label: `${controller.name}.${name}`,
                isPublic:
                    reflector.getAllAndOverride<boolean>(
                        IS_PUBLIC_KEY,
                        targets,
                    ) === true,
                roles: reflector.getAllAndOverride<Role[] | undefined>(
                    ROLES_KEY,
                    targets,
                ),
                ownRoles: Reflect.getMetadata(ROLES_KEY, handler) as
                    Role[] | undefined,
                classRoles: Reflect.getMetadata(ROLES_KEY, controller) as
                    Role[] | undefined,
            };
        }),
    ),
);

describe('Route role declarations', () => {
    it('finds the controllers', () => {
        const labels = routes.map((r) => r.label);
        expect(labels).toEqual(
            expect.arrayContaining([
                'DashboardController.getDashboard',
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

            if (route.isPublic) return;
            expect(route.roles?.length ?? 0).toBeGreaterThan(0);
        },
    );
});
