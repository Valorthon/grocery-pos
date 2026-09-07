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

/** Decoded JWT contents. The API signs it; the client reads it back via /users/profile. */
export interface JWTPayload {
    userId: string;
    username: string;
    roles: Role[];
}

export type AuthUser = JWTPayload;
