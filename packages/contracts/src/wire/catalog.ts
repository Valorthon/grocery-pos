import type { Category } from '../enums.js';
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
    _id: string;
    /** As scanned: EAN-13, UPC-A or EAN-8, or a generated 200… code. */
    EAN: string;
    /** Stored lowercase. */
    name: string;
    /** Centavos. */
    price: number;
    category?: Category;
    createdAt: string;
    updatedAt: string;
}

export const PRODUCT_VIEW_SHAPE: WireShape<ProductView> = {
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
    EAN: string;
    name: string;
    /** The product's id. */
    product: string;
}

export const PRODUCT_MATCH_SHAPE: WireShape<ProductMatch> = {
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
    _id: string;
    description: string;
    restockedBy: UserRef | null;
    /** Centavos. */
    totalCost: number;
    createdAt: string;
    updatedAt: string;
}

export const RESTOCK_ROW_SHAPE: WireShape<RestockRow> = {
    _id: 'required',
    description: 'required',
    restockedBy: 'required',
    totalCost: 'required',
    createdAt: 'required',
    updatedAt: 'required',
};

/** A line of `GET /restocks/details/:id`, with its product. */
export interface RestockLine {
    _id: string;
    /** The restock's id. */
    restock: string;
    product: ProductView;
    quantity: number;
    /** Centavos. */
    unitCost: number;
}

export const RESTOCK_LINE_SHAPE: WireShape<RestockLine> = {
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
    _id: string;
    /** The adjustment's id. */
    adjustment: string;
    product: ProductView;
    /** Units added (positive) or removed (negative). */
    change: number;
    reason: string;
}

export const ADJUSTMENT_LINE_SHAPE: WireShape<AdjustmentLine> = {
    _id: 'required',
    adjustment: 'required',
    product: 'required',
    change: 'required',
    reason: 'required',
};
