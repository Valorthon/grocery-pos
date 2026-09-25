/**
 * Finds the DTO classes the controllers under src/ validate, from Nest's
 * route-args metadata, so specs can check every DTO of a kind and a new
 * route cannot go unchecked. Test-only: excluded from the build.
 */
import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';

type Constructor = abstract new (...args: never[]) => unknown;

function controllerFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return controllerFiles(path);
        return entry.name.endsWith('.controller.ts') ? [path] : [];
    });
}

/** Classes decorated with `@Controller()` (as route-roles.spec.ts does). */
function controllersIn(file: string): Constructor[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exports = require(file) as Record<string, unknown>;
    return Object.values(exports).filter(
        (value): value is Constructor =>
            typeof value === 'function' &&
            Reflect.getMetadata('__controller__', value) === true,
    );
}

/**
 * The declared type of every `@Body()` (or `@Query()`, ...) parameter of
 * every route handler under src/.
 */
export function routeDtos(paramtype: RouteParamtypes): Type<unknown>[] {
    const found = new Set<Type<unknown>>();
    for (const file of controllerFiles(join(__dirname, '..', '..'))) {
        for (const controller of controllersIn(file)) {
            const proto = controller.prototype as object;
            for (const name of Object.getOwnPropertyNames(proto)) {
                const args = Reflect.getMetadata(
                    ROUTE_ARGS_METADATA,
                    controller,
                    name,
                ) as Record<string, { index: number }> | undefined;
                const types = Reflect.getMetadata(
                    'design:paramtypes',
                    proto,
                    name,
                ) as Type<unknown>[] | undefined;
                for (const [key, { index }] of Object.entries(args ?? {})) {
                    if (key.split(':')[0] !== String(paramtype)) continue;
                    const type = types?.[index];
                    if (type && type !== Object) found.add(type);
                }
            }
        }
    }
    return [...found];
}
