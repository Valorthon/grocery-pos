import type { UnitOfMeasure } from './enums.js';
import type { WireShape } from './wire-shape.js';

export enum StockMovementType {
    SALE = 'SALE',
    RESTOCK = 'RESTOCK',
    ADJUSTMENT = 'ADJUSTMENT',
    VOID = 'VOID',
    REFUND = 'REFUND',
    COUNT = 'COUNT',
    OPENING = 'OPENING',
}
export enum StockMovementSource {
    SALE = 'Sales',
    RESTOCK = 'Restock',
    ADJUSTMENT = 'Adjustment',
    COUNT = 'StockCount',
    OPENING = 'Opening',
}
/** Quantities and balances are signed safe integer minor units, never money. */
export interface StockMovementView {
    _id: string;
    product: string;
    type: StockMovementType;
    quantity: number;
    balanceAfter: number;
    unit: UnitOfMeasure;
    sequence: number;
    refModel: StockMovementSource;
    refId?: string;
    user: { _id: string; name: string } | null;
    /** Source event time; offline uploads may arrive later. */
    occurredAt: string;
    /** When this ledger entry was recorded. */
    createdAt: string;
    /** Reconstructed source events have derived, not contemporaneous, balances. */
    historical: boolean;
}
export const STOCK_MOVEMENT_SHAPE: WireShape<StockMovementView> = {
    _id: 'required',
    product: 'required',
    type: 'required',
    quantity: 'required',
    balanceAfter: 'required',
    unit: 'required',
    sequence: 'required',
    refModel: 'required',
    refId: 'optional',
    user: 'required',
    occurredAt: 'required',
    createdAt: 'required',
    historical: 'required',
};
export interface StockIntegrityView {
    product: string;
    stock: number;
    movementTotal: number;
    difference: number;
    matches: boolean;
}
export const STOCK_INTEGRITY_SHAPE: WireShape<StockIntegrityView> = {
    product: 'required',
    stock: 'required',
    movementTotal: 'required',
    difference: 'required',
    matches: 'required',
};
