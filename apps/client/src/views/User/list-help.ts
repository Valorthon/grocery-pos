import { Role, ShiftStatus } from '@grocery-pos/contracts';
import type { StatusMap } from '@/components/ui/status-badge';
import { enumHelp, statusHelp } from '@/components/ui/column-help';
import type { ColumnHelp } from '@/components/ui/types';

/*
 * Column help for the admin lists (#263). Status lists are built from the
 * badge maps or enums, so a new value without a meaning fails to compile.
 */

export const SHIFT_STATUS: StatusMap<ShiftStatus> = {
    [ShiftStatus.OPEN]: { label: 'Open', color: 'success' },
    [ShiftStatus.CLOSED]: { label: 'Closed', color: 'neutral' },
};
export const SHIFT_HELP = {
    terminal: 'The register label set on that device; display only.',
    status: statusHelp(SHIFT_STATUS, {
        [ShiftStatus.OPEN]: 'The cashier is still selling.',
        [ShiftStatus.CLOSED]:
            'Cash counted and Z-read saved (by the cashier, or force-closed by an admin).',
    }),
    overShort:
        'Counted cash minus expected cash: + over, − short. "—" while the shift is open.',
} satisfies Record<string, ColumnHelp>;

export const PRODUCT_STATUS: StatusMap<'active' | 'archived'> = {
    active: { label: 'Active', color: 'success' },
    archived: { label: 'Archived', color: 'neutral' },
};
export const PRODUCT_HELP = {
    cost: "The last receipt's unit cost per displayed unit, not an average cost. Margin estimate = (price − cost) ÷ price.",
    status: statusHelp(PRODUCT_STATUS, {
        active: 'Sellable.',
        archived: 'Not for sale; its history is kept.',
    }),
} satisfies Record<string, ColumnHelp>;

type AssignableRole = Exclude<Role, Role.Unauthenticated>;
export const USER_HELP = {
    roles: enumHelp<AssignableRole>({
        [Role.Seller]: 'Sells at the register and runs their own cash shifts.',
        [Role.Adjuster]: 'Adjusts stock and runs stock counts.',
        [Role.Restocker]:
            'Adds and edits products, receives stock, manages suppliers and purchase orders.',
        [Role.UserManager]: 'Manages Seller, Adjuster and Restocker accounts.',
        [Role.Admin]:
            'Everything else. To sell, an admin also needs the Seller role.',
        [Role.Supervisor]:
            'Approves reversals by PIN. Add another role to use the app.',
    }),
    status: "Inactive users can't log in; deactivating one ends their sessions.",
} satisfies Record<string, ColumnHelp>;

export const AUDIT_HELP = {
    action: 'The sensitive change recorded; View (Details) shows its before and after.',
    target: 'The type and id of the record affected.',
} satisfies Record<string, ColumnHelp>;

export const RESTOCK_HELP = {
    invoiceNumber:
        "The supplier's invoice or delivery receipt number (optional).",
    purchaseOrder: 'The purchase order this receipt was received against.',
} satisfies Record<string, ColumnHelp>;

export const ADJUSTMENT_HELP = {
    change: '+ added to stock, − removed.',
} satisfies Record<string, ColumnHelp>;

export const SUPPLIER_HELP = {
    status: [
        {
            term: 'Active',
            meaning: 'Can be picked for new receipts and orders.',
        },
        {
            term: 'Archived',
            meaning:
                "Kept on old records; can't be picked for new receipts or orders. Its open purchase orders can still be received or cancelled.",
        },
    ],
} satisfies Record<string, ColumnHelp>;

export const CATEGORY_HELP = {
    sortOrder: 'Sort position in lists.',
    status: [
        { term: 'Active', meaning: 'Can be assigned to products.' },
        {
            term: 'Archived',
            meaning:
                "Can't be newly assigned. Products keep it and still sell.",
        },
    ],
} satisfies Record<string, ColumnHelp>;
