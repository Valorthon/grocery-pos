import type { UnitOfMeasure } from '../enums.js';
import type { WireShape } from '../wire-shape.js';
import type { UserRef } from './users.js';

/** A populated product reference with its name only (`select: 'name'`). */
export interface ProductRef {
    _id: string;
    name: string;
}

export const PRODUCT_REF_SHAPE: WireShape<ProductRef> = {
    _id: 'required',
    name: 'required',
};

/**
 * A product: a row of `GET /products`, `GET /products/:EAN`, and the
 * product joined into inventory, restock and adjustment rows.
 */
export interface ProductView {
    tracksExpiry?: boolean;
    /** Integer minor units; absent defaults to ten displayed units. */
    reorderLevel?: number;
    reorderQuantity?: number;
    isActive?: boolean;
    /** Missing on legacy piece records. Quantity/stock use integer minor units. */
    unit?: UnitOfMeasure;
    _id: string;
    /** As scanned: EAN-13, UPC-A or EAN-8, or a generated 200… code. */
    EAN: string;
    /** Stored lowercase. */
    name: string;
    /** Centavos. */
    price: number;
    /** Category ObjectId; absent means uncategorized. */
    category?: string;
    createdAt: string;
    updatedAt: string;
}

export const PRODUCT_VIEW_SHAPE: WireShape<ProductView> = {
    tracksExpiry: 'optional',
    reorderLevel: 'optional',
    reorderQuantity: 'optional',
    isActive: 'optional',
    unit: 'optional',
    _id: 'required',
    EAN: 'required',
    name: 'required',
    price: 'required',
    category: 'optional',
    createdAt: 'required',
    updatedAt: 'required',
};

/** A row of `GET /products/matches` (the register and combobox search). */
export interface ProductMatch {
    tracksExpiry?: boolean;
    /** Missing on legacy piece records. Quantity/stock use integer minor units. */
    unit?: UnitOfMeasure;
    EAN: string;
    name: string;
    /** The product's id. */
    product: string;
}

export const PRODUCT_MATCH_SHAPE: WireShape<ProductMatch> = {
    tracksExpiry: 'optional',
    unit: 'optional',
    EAN: 'required',
    name: 'required',
    product: 'required',
};

/** A row of `GET /inventories`: a stock level with its product. */
export interface InventoryRow {
    _id: string;
    product: ProductView;
    stock: number;
    /** The last writer's user id. */
    updatedBy: string;
    createdAt: string;
    updatedAt: string;
}

export const INVENTORY_ROW_SHAPE: WireShape<InventoryRow> = {
    _id: 'required',
    product: 'required',
    stock: 'required',
    updatedBy: 'required',
    createdAt: 'required',
    updatedAt: 'required',
};

/** A row of `GET /restocks`. `restockedBy` is null once the user is gone. */
export interface RestockRow {
    supplier?: { _id: string; name: string } | null;
    invoiceNumber?: string;
    _id: string;
    description: string;
    restockedBy: UserRef | null;
    /** Centavos. */
    totalCost: number;
    createdAt: string;
    updatedAt: string;
}

export const RESTOCK_ROW_SHAPE: WireShape<RestockRow> = {
    supplier: 'optional',
    invoiceNumber: 'optional',
    _id: 'required',
    description: 'required',
    restockedBy: 'required',
    totalCost: 'required',
    createdAt: 'required',
    updatedAt: 'required',
};

/** A line of `GET /restocks/details/:id`, with its product. */
export interface RestockLine {
    expiryDate?: string;
    batchNo?: string;
    /** Missing on legacy piece records. Quantity/stock use integer minor units. */
    unit?: UnitOfMeasure;
    _id: string;
    /** The restock's id. */
    restock: string;
    product: ProductView;
    quantity: number;
    /** Centavos. */
    unitCost: number;
}

export const RESTOCK_LINE_SHAPE: WireShape<RestockLine> = {
    expiryDate: 'optional',
    batchNo: 'optional',
    unit: 'optional',
    _id: 'required',
    restock: 'required',
    product: 'required',
    quantity: 'required',
    unitCost: 'required',
};

/** A row of `GET /adjustments`. `adjustedBy` is null once the user is gone. */
export interface AdjustmentRow {
    _id: string;
    description: string;
    adjustedBy: UserRef | null;
    createdAt: string;
    updatedAt: string;
}

export const ADJUSTMENT_ROW_SHAPE: WireShape<AdjustmentRow> = {
    _id: 'required',
    description: 'required',
    adjustedBy: 'required',
    createdAt: 'required',
    updatedAt: 'required',
};

/** A line of `GET /adjustments/details/:id`, with its product. */
export interface AdjustmentLine {
    batch?: string;
    _id: string;
    /** The adjustment's id. */
    adjustment: string;
    product: ProductView;
    /** Units added (positive) or removed (negative). */
    change: number;
    reason: string;
}

export const ADJUSTMENT_LINE_SHAPE: WireShape<AdjustmentLine> = {
    batch: 'optional',
    _id: 'required',
    adjustment: 'required',
    product: 'required',
    change: 'required',
    reason: 'required',
};
