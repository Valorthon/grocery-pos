/**
 * Single source of truth for authorization roles.
 * Previously duplicated byte-for-byte in the API (auth/types/auth.types.ts)
 * and the client (stores/auth.ts).
 */
export enum Role {
    Seller = 'SELLER',
    Adjuster = 'ADJUSTER',
    Restocker = 'RESTOCKER',
    UserManager = 'USER_MANAGER',
    Admin = 'ADMIN',
    Unauthenticated = 'UNAUTHENTICATED',
}

/**
 * Roles that can be stored on a user. `Unauthenticated` is a placeholder the
 * API uses for anonymous callers on public routes; it is never assignable.
 */
export const ASSIGNABLE_ROLES: readonly Role[] = [
    Role.Seller,
    Role.Adjuster,
    Role.Restocker,
    Role.UserManager,
    Role.Admin,
];

/**
 * Roles a USER_MANAGER (without ADMIN) may grant, and the only roles a user
 * may hold for such a manager to create, edit or deactivate them. ADMIN and
 * USER_MANAGER are granted, and their holders managed, by an ADMIN only.
 */
export const MANAGEABLE_ROLES: readonly Role[] = [
    Role.Seller,
    Role.Adjuster,
    Role.Restocker,
];

/** Whether `actorRoles` includes `role`. ADMIN holds every role, as in RoleGuard. */
export function holdsRole(actorRoles: readonly Role[], role: Role): boolean {
    return actorRoles.includes(Role.Admin) || actorRoles.includes(role);
}

/** Whether someone holding `actorRoles` may grant `role` (issue #3). */
export function canGrantRole(actorRoles: readonly Role[], role: Role): boolean {
    if (actorRoles.includes(Role.Admin)) return ASSIGNABLE_ROLES.includes(role);
    return (
        actorRoles.includes(Role.UserManager) && MANAGEABLE_ROLES.includes(role)
    );
}

/**
 * Whether someone holding `actorRoles` may modify a user holding
 * `targetRoles`: an ADMIN anyone, a USER_MANAGER only users whose roles are
 * all in MANAGEABLE_ROLES.
 */
export function canManageUser(
    actorRoles: readonly Role[],
    targetRoles: readonly Role[],
): boolean {
    if (actorRoles.includes(Role.Admin)) return true;
    return (
        actorRoles.includes(Role.UserManager) &&
        targetRoles.every((role) => MANAGEABLE_ROLES.includes(role))
    );
}

/** Decoded JWT contents. The API signs it; the client reads it back via /users/profile. */
export interface JWTPayload {
    userId: string;
    username: string;
    roles: Role[];
}

export type AuthUser = JWTPayload;
