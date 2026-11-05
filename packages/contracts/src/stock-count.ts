import type { UnitOfMeasure } from './enums.js';
import type { WireShape } from './wire-shape.js';

export enum StockCountStatus {
    OPEN = 'OPEN',
    SUBMITTED = 'SUBMITTED',
    APPROVED = 'APPROVED',
    CANCELLED = 'CANCELLED',
}

/** Each count posts at most one bounded adjustment, including batch lines. */
export const STOCK_COUNT_LINE_MAX = 200;

export interface CreateStockCountRequest {
    scope: 'all' | 'category' | 'products';
    category?: string;
    products?: string[];
}

/** Quantities are integer minor units. Missing is uncounted; zero is a count. */
export interface StockCountLineInput {
    line: string;
    countedQty: number;
}
export interface SaveStockCountRequest {
    version: number;
    lines: StockCountLineInput[];
}
export interface StockCountVersionRequest {
    version: number;
}

export interface StockCountLineView {
    _id: string;
    product: string;
    name: string;
    EAN: string;
    unit: UnitOfMeasure;
    tracksExpiry: boolean;
    batch?: string;
    batchNo?: string;
    expiryDate?: string;
    /** Current observed balance for review; omitted after closure. */
    currentQty?: number;
    expectedQty: number;
    countedQty?: number;
    variance?: number;
}
export interface StockCountView {
    _id: string;
    scope: 'all' | 'category' | 'products';
    category?: string;
    status: StockCountStatus;
    version: number;
    createdBy: { _id: string; name: string } | null;
    approvedBy?: { _id: string; name: string } | null;
    adjustment?: string;
    lines: StockCountLineView[];
    createdAt: string;
    updatedAt: string;
}
export const STOCK_COUNT_LINE_SHAPE: WireShape<StockCountLineView> = {
    _id: 'required',
    product: 'required',
    name: 'required',
    EAN: 'required',
    unit: 'required',
    tracksExpiry: 'required',
    batch: 'optional',
    batchNo: 'optional',
    expiryDate: 'optional',
    currentQty: 'optional',
    expectedQty: 'required',
    countedQty: 'optional',
    variance: 'optional',
};
export const STOCK_COUNT_SHAPE: WireShape<StockCountView> = {
    _id: 'required',
    scope: 'required',
    category: 'optional',
    status: 'required',
    version: 'required',
    createdBy: 'required',
    approvedBy: 'optional',
    adjustment: 'optional',
    lines: 'required',
    createdAt: 'required',
    updatedAt: 'required',
};
