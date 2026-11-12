import type { Component } from 'vue';
import { ClipboardEdit, Crown, ShoppingCart, Truck, Users } from '@lucide/vue';
import { Role } from '@grocery-pos/contracts';

/** Every role a user can hold (contracts `ASSIGNABLE_ROLES`). */
export type AssignableRole = Exclude<Role, Role.Unauthenticated>;

export interface RoleLook {
    /** The friendly name shown instead of the role code. */
    label: string;
    icon: Component;
    avatarClass: string;
    /** One line on what the role can do (Users dialogs, #297). */
    description: string;
    /** A Roles-page note. */
    note?: string;
}

/**
 * How each role looks on the Roles page and in the Users dialogs and list
 * (#297). A `Record`, so a new role without a look fails to compile.
 */
export const ROLE_LOOK: Record<AssignableRole, RoleLook> = {
    [Role.Seller]: {
        label: 'Seller',
        icon: ShoppingCart,
        avatarClass: 'bg-emerald-50 text-emerald-600',
        description: 'Runs the register and their own cash shifts',
    },
    [Role.Adjuster]: {
        label: 'Adjuster',
        icon: ClipboardEdit,
        avatarClass: 'bg-amber-50 text-amber-600',
        description: 'Adjusts stock and runs stock counts',
    },
    [Role.Restocker]: {
        label: 'Restocker',
        icon: Truck,
        avatarClass: 'bg-sky-50 text-sky-600',
        description:
            'Receives stock, manages products, suppliers and purchase orders',
    },
    [Role.UserManager]: {
        label: 'User manager',
        icon: Users,
        avatarClass: 'bg-purple-50 text-purple-600',
        description: 'Manages Seller, Adjuster and Restocker accounts',
    },
    [Role.Admin]: {
        label: 'Admin',
        icon: Crown,
        avatarClass: 'bg-leaf-50 text-leaf-600',
        description: 'Full access; needs Seller to sell',
        // Selling and cash shifts are `ownRoleOnly` in PERMISSIONS (#84).
        note: 'To sell, an admin also needs the Seller role.',
    },
    [Role.Supervisor]: {
        label: 'Supervisor',
        icon: Crown,
        avatarClass: 'bg-indigo-50 text-indigo-600',
        description:
            'Approves voids, refunds and stock counts by PIN; add another role to use the app',
        note: 'Approves reversals by PIN. Add another role to use the app.',
    },
};

/** The role's friendly name; an unknown code is shown as stored. */
export function roleLabel(role: Role): string {
    return (ROLE_LOOK as Partial<Record<Role, RoleLook>>)[role]?.label ?? role;
}
