import type { UnitOfMeasure } from './enums.js';
import type { WireShape } from './wire-shape.js';

export const EXPIRY_LIMITS = {
    BATCH_NO: 80,
    DAYS_MAX: 365,
    DEFAULT_DAYS: 7,
} as const;
/** One allocation of sold integer minor units. */
export interface BatchAllocation {
    batch: string;
    quantity: number;
}
export interface InventoryBatchView {
    _id: string;
    product: { _id: string; name: string; EAN: string; unit?: UnitOfMeasure };
    restockDetail?: string;
    batchNo?: string;
    /** Store calendar day, usable through the end of that day. */
    expiryDate?: string;
    daysLeft?: number;
    receivedQty: number;
    remainingQty: number;
    reconciliation: boolean;
    createdAt: string;
    updatedAt: string;
}
export const INVENTORY_BATCH_SHAPE: WireShape<InventoryBatchView> = {
    _id: 'required',
    product: 'required',
    restockDetail: 'optional',
    batchNo: 'optional',
    expiryDate: 'optional',
    daysLeft: 'optional',
    receivedQty: 'required',
    remainingQty: 'required',
    reconciliation: 'required',
    createdAt: 'required',
    updatedAt: 'required',
};
/** `GET /inventories/expiry-tracking`: active products that track expiry (#233). */
export interface ExpiryTrackingView {
    trackedProducts: number;
}
export const EXPIRY_TRACKING_SHAPE: WireShape<ExpiryTrackingView> = {
    trackedProducts: 'required',
};

/** Calendar date validation shared with browser receipt forms. */
export function isExpiryDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
        Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
    );
}
