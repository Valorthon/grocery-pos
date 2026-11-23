import type { ReceiptStoreIdentity } from './settings.js';
import type { UnitOfMeasure } from './enums.js';
import type { CurrentShiftView } from './shift.js';
import type { Receipt } from './wire/sales.js';
import type { WireShape } from './wire-shape.js';

/** Server-attested, cashier/shift-bound cached price. Never an auth token. */
export interface OfflineProduct {
    /** Inactive entry is a tombstone; proof is empty. */
    isActive?: boolean;
    _id: string;
    EAN: string;
    name: string;
    price: number;
    unit: UnitOfMeasure;
    updatedAt: string;
    proof: string;
}
export interface OfflineLeaseRequest {
    terminalId: string;
    /** The device's saved terminal label, shown when it blocks a close (#454). */
    terminalLabel?: string;
}
export interface OfflineLeaseView {
    storeIdentity?: ReceiptStoreIdentity;
    _id: string;
    cashier: string;
    cashierName: string;
    issuedAt: string;
    expiresAt: string;
    shift: CurrentShiftView;
    /** Server clock (epoch ms) when answering, for terminal clock correction (#398). */
    serverTime: number;
}
export interface OfflineCatalogRequest {
    lease: string;
    after?: string;
    limit?: number;
}
export interface OfflineCatalogPage {
    products: OfflineProduct[];
    next: string | null;
    /** Server clock (epoch ms) when answering, for terminal clock correction (#398). */
    serverTime: number;
}
export interface OfflineSaleLine {
    product: string;
    quantity: number;
    proof: string;
}
/** Cash already collected; idempotencyKey survives every retry/reload. */
export interface OfflineSaleRequest {
    lease: string;
    idempotencyKey: string;
    soldAt: string;
    amountTendered: number;
    lines: OfflineSaleLine[];
}
export interface ReconcileOfflineSaleRequest extends OfflineSaleRequest {
    reason: string;
}
export interface OfflinePendingSale {
    owner: string;
    request: OfflineSaleRequest;
    receipt: Receipt;
    blocked?: string;
}
export interface OfflineAddendum {
    count: number;
    netCash: number;
}
export const OFFLINE_LEASE_SHAPE: WireShape<OfflineLeaseView> = {
    storeIdentity: 'optional',
    _id: 'required',
    cashier: 'required',
    cashierName: 'required',
    issuedAt: 'required',
    expiresAt: 'required',
    shift: 'required',
    serverTime: 'required',
};
export const OFFLINE_PRODUCT_SHAPE: WireShape<OfflineProduct> = {
    isActive: 'optional',
    _id: 'required',
    EAN: 'required',
    name: 'required',
    price: 'required',
    unit: 'required',
    updatedAt: 'required',
    proof: 'required',
};
export const OFFLINE_CATALOG_SHAPE: WireShape<OfflineCatalogPage> = {
    products: 'required',
    next: 'required',
    serverTime: 'required',
};
