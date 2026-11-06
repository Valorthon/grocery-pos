import type { UnitOfMeasure } from './enums.js';
import type { WireShape } from './wire-shape.js';

/** Purchase-order lifecycle (#123). SENT is a status only: no email or print. */
export enum PurchaseOrderStatus {
    DRAFT = 'DRAFT',
    SENT = 'SENT',
    PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
    RECEIVED = 'RECEIVED',
    CANCELLED = 'CANCELLED',
}

/** Statuses that still accept a receipt or a cancellation that closes short. */
export const OPEN_PURCHASE_ORDER_STATUSES: readonly PurchaseOrderStatus[] = [
    PurchaseOrderStatus.SENT,
    PurchaseOrderStatus.PARTIALLY_RECEIVED,
];

/** Readable PO reference shown on screens and in default receipt text. */
export function purchaseOrderReference(id: string): string {
    return `PO-${id.slice(-8).toUpperCase()}`;
}

/** A draft that cannot be sent as it stands (#123): archived supplier or products. */
export function draftSendBlockers(
    po: Pick<PurchaseOrderView, 'status' | 'supplier' | 'lines'>,
): string[] {
    if (po.status !== PurchaseOrderStatus.DRAFT) return [];
    const out: string[] = [];
    // send() refuses a missing supplier too, so name it here.
    if (!po.supplier) out.push('Unknown supplier.');
    else if (!po.supplier.isActive)
        out.push(`Supplier ${po.supplier.name} is archived.`);
    const archived = po.lines.filter((l) => !l.productActive);
    if (archived.length)
        out.push(
            `Archived ${archived.length === 1 ? 'product' : 'products'}: ${archived
                .map((l) => l.name || l.EAN)
                .join(', ')}.`,
        );
    return out;
}

export const PURCHASE_ORDER_LIMITS = {
    NOTE: 300,
    /** Same bound as a restock, since one receipt is one restock. */
    LINES: 200,
    IDEMPOTENCY_KEY: 64,
} as const;

/** Quantities are integer minor units; costs are centavos per displayed unit. */
export interface PurchaseOrderLineInput {
    product: string;
    orderedQty: number;
    expectedCost: number;
}
export interface CreatePurchaseOrderRequest {
    supplier: string;
    note?: string;
    lines: PurchaseOrderLineInput[];
}
/** Replaces a DRAFT's supplier, note and lines at the given version. */
export interface UpdatePurchaseOrderRequest extends CreatePurchaseOrderRequest {
    version: number;
}
export interface PurchaseOrderVersionRequest {
    version: number;
}
export interface PurchaseOrderReceiptLineInput {
    /** The PO line id. */
    line: string;
    /** At most the line's outstanding quantity. */
    quantity: number;
    /** Actual invoice cost, centavos; becomes the product's lastCost (#41). */
    unitCost: number;
    expiryDate?: string;
    batchNo?: string;
}
export interface ReceivePurchaseOrderRequest {
    version: number;
    /** Client-chosen per receive attempt; a retry with it replays. */
    idempotencyKey: string;
    invoiceNumber?: string;
    description?: string;
    lines: PurchaseOrderReceiptLineInput[];
}

export interface PurchaseOrderLineView {
    _id: string;
    product: string;
    name: string;
    EAN: string;
    unit: UnitOfMeasure;
    tracksExpiry: boolean;
    /** False once the product is archived: a draft cannot be sent. */
    productActive: boolean;
    orderedQty: number;
    receivedQty: number;
    outstandingQty: number;
    /** Centavos per displayed unit. */
    expectedCost: number;
}
export interface PurchaseOrderView {
    _id: string;
    supplier: { _id: string; name: string; isActive: boolean } | null;
    status: PurchaseOrderStatus;
    version: number;
    note?: string;
    createdBy: { _id: string; name: string } | null;
    sentAt?: string;
    cancelledAt?: string;
    /** Cancelled after a partial receipt: the outstanding rest was closed short. */
    closedShort: boolean;
    /** Linked supplier restocks, one per receive, oldest first. */
    receipts: string[];
    /** Centavos: sum of ordered quantity × expected cost. */
    expectedTotal: number;
    lines: PurchaseOrderLineView[];
    createdAt: string;
    updatedAt: string;
}
export const PURCHASE_ORDER_LINE_SHAPE: WireShape<PurchaseOrderLineView> = {
    _id: 'required',
    product: 'required',
    name: 'required',
    EAN: 'required',
    unit: 'required',
    tracksExpiry: 'required',
    productActive: 'required',
    orderedQty: 'required',
    receivedQty: 'required',
    outstandingQty: 'required',
    expectedCost: 'required',
};
export const PURCHASE_ORDER_SHAPE: WireShape<PurchaseOrderView> = {
    _id: 'required',
    supplier: 'required',
    status: 'required',
    version: 'required',
    note: 'optional',
    createdBy: 'required',
    sentAt: 'optional',
    cancelledAt: 'optional',
    closedShort: 'required',
    receipts: 'required',
    expectedTotal: 'required',
    lines: 'required',
    createdAt: 'required',
    updatedAt: 'required',
};
