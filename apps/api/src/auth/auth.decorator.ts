import { applyDecorators, SetMetadata } from '@nestjs/common';
import { Role } from './types';

export const IS_PUBLIC_KEY = 'isPublic';
/**
 * Marks a route (or controller) as callable whether or not the caller is
 * signed in: `JWTAuthGuard` lets a missing or bad token through and
 * `RoleGuard` skips its role check. Do not combine with `@Roles`.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/**
 * Whether ADMIN passes a route's role check on its own. Always set
 * together with `ROLES_KEY`, by `@Roles` (true) or `@RequireOwnRole`
 * (false), so a handler's decorator replaces the class's for both.
 */
export const ADMIN_BYPASS_KEY = 'adminBypass';

/**
 * The roles that may call a route. ADMIN holds every role, so it passes
 * too (RoleGuard).
 */
export const Roles = (...roles: Role[]) =>
    applyDecorators(
        SetMetadata(ROLES_KEY, roles),
        SetMetadata(ADMIN_BYPASS_KEY, true),
    );

/**
 * Like `@Roles`, but ADMIN does not count on its own: the caller must hold
 * one of `roles` itself (issue #84). Selling and a cashier's own shift
 * actions are `@RequireOwnRole(Role.Seller)`, so an admin account also
 * needs SELLER to sell. An empty list is refused like an empty `@Roles()`.
 */
export const RequireOwnRole = (...roles: Role[]) =>
    applyDecorators(
        SetMetadata(ROLES_KEY, roles),
        SetMetadata(ADMIN_BYPASS_KEY, false),
    );
