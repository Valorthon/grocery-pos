import type { AuditLogView, AuditValue, Role } from '@grocery-pos/contracts';
import { roleLabel } from '../role-look';

/** Friendly model names for the Target column and dialog (#306). */
const MODEL_LABELS: Record<string, string> = {
    User: 'User',
    Product: 'Product',
    PurchaseOrder: 'Purchase order',
    Sales: 'Sale',
    Shift: 'Shift',
    Settings: 'Settings',
};

/** The last 8 characters of an id. */
export function shortId(id: string): string {
    return id.slice(-8);
}

/** "User · admin", else the model and short id, else the model alone. */
export function targetText(target: AuditLogView['target']): string {
    if (target.model === 'Settings') return target.label ?? 'Store settings';
    const model = MODEL_LABELS[target.model] ?? target.model;
    if (target.label) return `${model} · ${target.label}`;
    return target.id ? `${model} · ${shortId(target.id)}` : model;
}

/** An id shortened for display: first 8 … last 5. */
export function elidedId(id: string): string {
    return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-5)}` : id;
}

const FIELD_LABELS: Record<string, string> = {
    isActive: 'Active',
    EAN: 'Barcode',
    cashIn: 'Cash in',
    PIN: 'PIN',
};

/** `passwordChanged` → "Password changed". */
export function fieldLabel(key: string): string {
    if (FIELD_LABELS[key]) return FIELD_LABELS[key];
    const words = key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_.]+/g, ' ')
        .trim()
        .toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A missing side is "—", null "empty", booleans Yes/No, lists joined. */
export function valueText(key: string, value: AuditValue | undefined): string {
    if (value === undefined) return '—';
    if (value === null) return 'empty';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) {
        const items =
            key === 'roles'
                ? value.map((role) => roleLabel(role as Role))
                : value;
        return items.length ? items.join(', ') : 'none';
    }
    return String(value);
}

export interface ChangeRow {
    key: string;
    field: string;
    before: string;
    after: string;
    changed: boolean;
}

/** One row per key of either side, in first-seen order. */
export function changeRows(
    before: Record<string, AuditValue>,
    after: Record<string, AuditValue>,
): ChangeRow[] {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.map((key) => {
        const left = valueText(key, before[key]),
            right = valueText(key, after[key]);
        return {
            key,
            field: fieldLabel(key),
            before: left,
            after: right,
            changed: left !== right,
        };
    });
}
