import { canGrantRole, canManageUser } from '@grocery-pos/contracts';
import { Role } from '../auth/types';
import { ErrorCode, ForbiddenError } from '../common/errors';

/**
 * Who may change whom (issue #3). Pure functions over the actor's and the
 * target's stored state, so the rules are unit-testable without a database.
 * The actor's roles come from the database, not the JWT, so a demotion takes
 * effect on the next request instead of when the access token expires.
 *
 * An ADMIN may grant any role and modify anyone. A USER_MANAGER without
 * ADMIN may grant only MANAGEABLE_ROLES (SELLER, ADJUSTER, RESTOCKER) and
 * modify only users whose roles all fall in that set, so ADMIN and
 * USER_MANAGER holders (other managers included) are ADMIN-only. A
 * USER_MANAGER may rename themselves but never deactivate themselves (#61).
 */
export interface PolicyUser {
    id: string;
    roles: readonly Role[];
    isActive: boolean;
}

export interface UserChange {
    name?: string;
    password?: string;
    roles?: readonly Role[];
    isActive?: boolean;
}

export const isAdmin = (roles: readonly Role[]): boolean =>
    roles.includes(Role.Admin);

/** Same set of roles, ignoring order. */
export function sameRoles(a: readonly Role[], b: readonly Role[]): boolean {
    const left = new Set(a);
    const right = new Set(b);
    return left.size === right.size && [...left].every((r) => right.has(r));
}

/** Rule 1: which roles the actor may give out. */
export function assertCanGrant(
    actorRoles: readonly Role[],
    roles: readonly Role[],
): void {
    const denied = roles.filter((role) => !canGrantRole(actorRoles, role));
    if (denied.length > 0) {
        throw new ForbiddenError(
            ErrorCode.USER_ROLE_NOT_GRANTABLE,
            `You cannot grant these roles: ${denied.join(', ')}`,
            { roles: denied },
        );
    }
}

/** Rules 1-4 for one entry of `PATCH /users`. */
export function assertCanUpdate(
    actor: PolicyUser,
    target: PolicyUser,
    change: UserChange,
): void {
    const self = actor.id === target.id;

    // Rule 3: a USER_MANAGER cannot touch an ADMIN or another USER_MANAGER
    // (name, roles, password or isActive). Your own account is the
    // exception: rules 2 and 4 below cover what you may change on it.
    if (!self && !canManageUser(actor.roles, target.roles)) {
        throw new ForbiddenError(
            ErrorCode.USER_TARGET_FORBIDDEN,
            'Only an admin can modify an admin or a user manager',
            { user: target.id },
        );
    }

    // Resending the current roles (the edit form always sends them) is not
    // a change.
    if (change.roles && !sameRoles(change.roles, target.roles)) {
        // Rule 2: nobody changes their own roles, ADMIN included. It stops
        // self-escalation and self-demotion lockouts alike.
        if (self) {
            throw new ForbiddenError(
                ErrorCode.USER_SELF_ROLE_CHANGE,
                'You cannot change your own roles',
            );
        }
        assertCanGrant(actor.roles, change.roles);
    }

    // Rule 6 (issue #61): a USER_MANAGER may rename themselves but not
    // deactivate themselves. An ADMIN deactivating themselves is left to
    // the last-active-admin check in the service (USER_LAST_ADMIN).
    // Resending `isActive: true` on your own active account is not a change.
    if (self && change.isActive === false && !isAdmin(actor.roles)) {
        throw new ForbiddenError(
            ErrorCode.USER_SELF_DEACTIVATE,
            'You cannot deactivate your own account',
        );
    }

    // Rule 4: resetting someone else's password is ADMIN-only; your own
    // goes through PATCH /users/me/password, which checks the current one.
    if (change.password !== undefined) {
        if (self) {
            throw new ForbiddenError(
                ErrorCode.USER_PASSWORD_RESET_FORBIDDEN,
                'Change your own password with PATCH /users/me/password',
            );
        }
        if (!isAdmin(actor.roles)) {
            throw new ForbiddenError(
                ErrorCode.USER_PASSWORD_RESET_FORBIDDEN,
                "Only an admin can reset another user's password",
                { user: target.id },
            );
        }
    }
}

/** Whether this change takes an active ADMIN out of the active-admin set. */
export function removesActiveAdmin(
    target: PolicyUser,
    change: UserChange,
): boolean {
    if (!target.isActive || !isAdmin(target.roles)) return false;
    return (
        change.isActive === false ||
        (change.roles !== undefined && !isAdmin(change.roles))
    );
}
