import { Role } from '@grocery-pos/contracts';

/**
 * Whether Restock History links a receipt to its purchase order (#123).
 * Defensive only: the page itself already needs RESTOCKER or ADMIN, the
 * same roles that can open purchase orders, so today every viewer passes.
 * It keeps the link from appearing if the page's roles ever widen.
 */
export function canOpenPurchaseOrders(
    hasRole: (role: Role) => boolean,
): boolean {
    return hasRole(Role.Admin) || hasRole(Role.Restocker);
}
