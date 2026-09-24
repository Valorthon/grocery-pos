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
 * Whether someone holding `actorRoles` holds `role`. ADMIN holds every role
 * implicitly, matching the API's RoleGuard. A user may only grant roles they
 * hold (issue #3).
 */
export function holdsRole(actorRoles: readonly Role[], role: Role): boolean {
    return actorRoles.includes(Role.Admin) || actorRoles.includes(role);
}

/** Decoded JWT contents. The API signs it; the client reads it back via /users/profile. */
export interface JWTPayload {
    userId: string;
    username: string;
    roles: Role[];
}

export type AuthUser = JWTPayload;
