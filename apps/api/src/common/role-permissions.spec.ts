/**
 * The Roles page's permission table matches what the server enforces
 * (issue #24).
 *
 * `PERMISSIONS` in contracts is what the client shows on its Roles page.
 * This spec loads every controller and checks the table both ways: each
 * route a permission names has exactly that permission's roles as its
 * effective `@Roles(...)`, and every route that is not `@Public()` is named
 * by some permission. A permission is `ownRoleOnly` exactly when its routes
 * are `@RequireOwnRole(...)` (ADMIN alone does not pass them, #84). Changing a route's roles, or adding a route, fails
 * here until the table (and so the page) says the same.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS, permissionsOf } from '@grocery-pos/contracts';
import {
    ADMIN_BYPASS_KEY,
    IS_PUBLIC_KEY,
    ROLES_KEY,
} from '../auth/auth.decorator';
import { Role } from '../auth/types';

type Constructor = abstract new (...args: never[]) => unknown;

const SRC = join(__dirname, '..');

function controllerFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return controllerFiles(path);
        return entry.name.endsWith('.controller.ts') ? [path] : [];
    });
}

function controllersIn(file: string): Constructor[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exports = require(file) as Record<string, unknown>;
    return Object.values(exports).filter(
        (value): value is Constructor =>
            typeof value === 'function' &&
            Reflect.getMetadata('__controller__', value) === true,
    );
}

function joinPath(...parts: Array<string | undefined>): string {
    const segments = parts
        .map((p) => (p ?? '').replace(/^\/+|\/+$/g, ''))
        .filter(Boolean);
    return `/${segments.join('/')}`;
}

const reflector = new Reflector();

interface Route {
    key: string;
    isPublic: boolean;
    roles: Role[];
    /** Whether ADMIN passes on its own (false on `@RequireOwnRole`). */
    adminBypass: boolean;
}

const routes: Route[] = controllerFiles(SRC).flatMap((file) =>
    controllersIn(file).flatMap((controller) => {
        const proto = controller.prototype as Record<string, unknown>;
        const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
        return Object.getOwnPropertyNames(proto)
            .filter((name) => name !== 'constructor')
            .map((name) => proto[name])
            .filter(
                (handler): handler is (...args: unknown[]) => unknown =>
                    typeof handler === 'function' &&
                    Reflect.getMetadata(METHOD_METADATA, handler) !== undefined,
            )
            .map((handler) => {
                const method = Reflect.getMetadata(
                    METHOD_METADATA,
                    handler,
                ) as RequestMethod;
                const path = Reflect.getMetadata(PATH_METADATA, handler) as
                    string | undefined;
                const targets = [handler, controller];
                return {
                    key: `${RequestMethod[method]} ${joinPath(base, path)}`,
                    isPublic:
                        reflector.getAllAndOverride<boolean>(
                            IS_PUBLIC_KEY,
                            targets,
                        ) === true,
                    roles:
                        reflector.getAllAndOverride<Role[] | undefined>(
                            ROLES_KEY,
                            targets,
                        ) ?? [],
                    adminBypass:
                        reflector.getAllAndOverride<boolean | undefined>(
                            ADMIN_BYPASS_KEY,
                            targets,
                        ) !== false,
                };
            });
    }),
);

const byKey = new Map(routes.map((r) => [r.key, r]));

describe('Roles page permissions (PERMISSIONS in contracts)', () => {
    it('finds the routes', () => {
        expect([...byKey.keys()]).toEqual(
            expect.arrayContaining([
                'POST /sales',
                'POST /sales/:id/void',
                'GET /products/:EAN',
                'PATCH /users/me/password',
            ]),
        );
    });

    it.each(
        PERMISSIONS.flatMap((p) =>
            p.routes.map(
                (route) =>
                    [p.label, route, p.roles, p.ownRoleOnly === true] as const,
            ),
        ),
    )(
        '"%s": %s lets exactly its roles through',
        (_label, key, roles, ownRoleOnly) => {
            const route = byKey.get(key);
            expect(route).toBeDefined();
            expect(route!.isPublic).toBe(false);
            expect([...route!.roles].sort()).toEqual([...roles].sort());
            // ADMIN passes on its own exactly when the table says so.
            expect(route!.adminBypass).toBe(!ownRoleOnly);
        },
    );

    it('finds the own-role routes (#84)', () => {
        expect(
            routes
                .filter((r) => !r.isPublic && !r.adminBypass)
                .map((r) => r.key)
                .sort(),
        ).toEqual(
            [
                'POST /sales',
                'POST /shifts',
                'GET /shifts/current',
                'POST /shifts/current/drawer',
                'POST /shifts/current/close',
                'GET /shifts/last-closed',
            ].sort(),
        );
    });

    it('names every signed-in route under some permission', () => {
        const named = new Set(PERMISSIONS.flatMap((p) => p.routes));
        const missing = routes
            .filter((r) => !r.isPublic && !named.has(r.key))
            .map((r) => r.key);
        expect(missing).toEqual([]);
    });

    it('says why a permission with no route is enforced', () => {
        for (const p of PERMISSIONS) {
            if (p.routes.length === 0) expect(p.enforcedBy).toBeTruthy();
        }
    });

    it('gives ADMIN everything but selling, and a SELLER no stock or user pages', () => {
        const admin = permissionsOf(Role.Admin).map((p) => p.label);
        expect(admin).toHaveLength(
            PERMISSIONS.filter((p) => !p.ownRoleOnly).length,
        );
        expect(admin).not.toContain('Sell at the register');
        expect(admin).not.toContain('Run own cash shift');
        expect(admin).toContain('Void and refund sales');
        const seller = permissionsOf(Role.Seller).map((p) => p.label);
        expect(seller).toContain('Sell at the register');
        expect(seller).not.toContain('Stock dashboard');
        expect(seller).not.toContain('Void and refund sales');
        expect(seller).not.toContain('View inventory');
    });
});
