/**
 * Every controller the running app serves and every route handler on it,
 * found the way Nest finds them: by walking `AppModule`'s imports through
 * their `@Module()` metadata (issue #61), not by file name. A controller
 * in a file with another name, or one registered by a dynamic module, is
 * still found; one that no module registers is not served and is skipped.
 * Handlers are collected along the prototype chain, like Nest's
 * `MetadataScanner`, so a route inherited from a base class is checked too.
 * Test-only: excluded from the build.
 */
import 'reflect-metadata';
import { DynamicModule, ForwardReference, Type } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../../app.module';

export type Controller = Type<unknown>;
export type Handler = (...args: unknown[]) => unknown;

type ModuleRef =
    | Type<unknown>
    | DynamicModule
    | ForwardReference
    | Promise<DynamicModule>
    | undefined;

function isForwardRef(ref: object): ref is ForwardReference {
    return 'forwardRef' in ref;
}

function isDynamic(ref: object): ref is DynamicModule {
    return 'module' in ref;
}

/**
 * The controllers registered by `root` and every module it imports,
 * transitively, each once. Async dynamic modules (a `Promise`, e.g.
 * `ConfigModule.forRoot`) are library modules and never register ours.
 */
export function controllersOf(root: Type<unknown>): Controller[] {
    const seen = new Set<unknown>();
    const found = new Set<Controller>();

    const visit = (ref: ModuleRef): void => {
        if (!ref || ref instanceof Promise) return;
        if (isForwardRef(ref))
            return visit((ref.forwardRef as () => ModuleRef)());
        if (seen.has(ref)) return;
        seen.add(ref);

        const moduleClass = isDynamic(ref) ? ref.module : ref;
        const metadata = (key: string): unknown[] =>
            (Reflect.getMetadata(key, moduleClass) as unknown[] | undefined) ??
            [];

        const controllers = [
            ...metadata(MODULE_METADATA.CONTROLLERS),
            ...(isDynamic(ref) ? (ref.controllers ?? []) : []),
        ] as Controller[];
        controllers.forEach((c) => found.add(c));

        const imports = [
            ...metadata(MODULE_METADATA.IMPORTS),
            ...(isDynamic(ref) ? (ref.imports ?? []) : []),
        ] as ModuleRef[];
        imports.forEach(visit);
        if (isDynamic(ref)) visit(ref.module);
    };

    visit(root);
    return [...found];
}

/** Route handlers (methods with a request method) of a controller, own and inherited. */
export function handlersOf(controller: Controller): Array<[string, Handler]> {
    // Nest resolves each method name through the controller's prototype,
    // so an undecorated override hides a decorated base method.
    const names = new Set<string>();
    for (
        let proto = controller.prototype as object | null;
        proto && proto !== Object.prototype;
        proto = Object.getPrototypeOf(proto) as object | null
    ) {
        Object.getOwnPropertyNames(proto).forEach((name) => names.add(name));
    }
    const proto = controller.prototype as Record<string, unknown>;
    return [...names]
        .filter((name) => name !== 'constructor')
        .map((name) => [name, proto[name]] as [string, unknown])
        .filter(
            (entry): entry is [string, Handler] =>
                typeof entry[1] === 'function' &&
                Reflect.getMetadata(METHOD_METADATA, entry[1]) !== undefined,
        );
}

/** Every controller `AppModule` serves. */
export const appControllers = (): Controller[] => controllersOf(AppModule);
