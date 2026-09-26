import type { DiscountType } from '../discount.js';
import type { PaymentType } from '../enums.js';
import type { ReversalType, SaleStatus, Tender } from '../sales.js';
import type { WireShape } from '../wire-shape.js';
import type { ProductRef } from './catalog.js';
import type { UserRef } from './users.js';

/** One line of a receipt. Centavos. */
export interface ReceiptItem {
    productName: string;
    quantity: number;
    /** `unitPrice * quantity`, before the sale's discount. */
    amount: number;
}

export const RECEIPT_ITEM_SHAPE: WireShape<ReceiptItem> = {
    productName: 'required',
    quantity: 'required',
    amount: 'required',
};

/** The discount a receipt shows, as the server applied it. */
export interface ReceiptDiscount {
    type: DiscountType;
    /** A whole percent for PERCENT, centavos for FIXED, as requested. */
    value: number;
    reason: string;
    /** Centavos taken off the subtotal. */
    amount: number;
}

export const RECEIPT_DISCOUNT_SHAPE: WireShape<ReceiptDiscount> = {
    type: 'required',
    value: 'required',
    reason: 'required',
    amount: 'required',
};

/**
 * `POST /sales`: the receipt, and on an idempotent replay the same
 * receipt again. Every total is the server's. Also in
 * `details.receipt` of a SALE_IDEMPOTENCY_MISMATCH from the same cashier.
 */
export interface Receipt {
    /** The sale's id, for looking it up in Sales History. */
    _id: string;
    /** ISO timestamp. */
    createdAt: string;
    status: SaleStatus;
    paymentType: PaymentType;
    /** The GCash reference; null for a cash sale. */
    referenceNumber: string | null;
    tenders: Tender[];
    /** Centavos: the sum of the tenders. */
    amountTendered: number;
    /** Centavos, paid out of the cash tender. */
    changeGiven: number;
    cashierName: string;
    items: ReceiptItem[];
    /** Centavos: the sum of the undiscounted lines. */
    subtotal: number;
    /** Null when the sale has no discount. */
    discount: ReceiptDiscount | null;
    /** Centavos: the charged total, `subtotal - discount.amount`. */
    totalAmount: number;
}

export const RECEIPT_SHAPE: WireShape<Receipt> = {
    _id: 'required',
    createdAt: 'required',
    status: 'required',
    paymentType: 'required',
    referenceNumber: 'required',
    tenders: 'required',
    amountTendered: 'required',
    changeGiven: 'required',
    cashierName: 'required',
    items: 'required',
    subtotal: 'required',
    discount: 'required',
    totalAmount: 'required',
};

/** A sale's stored discount. */
export interface SaleDiscountView extends ReceiptDiscount {
    /** Who authorized it: today the cashier who rang the sale. */
    approvedBy: string;
}

export const SALE_DISCOUNT_VIEW_SHAPE: WireShape<SaleDiscountView> = {
    ...RECEIPT_DISCOUNT_SHAPE,
    approvedBy: 'required',
};

/** How a sale was voided or refunded. */
export interface SaleReversalView {
    type: ReversalType;
    reason: string;
    /** The ADMIN who reversed it. */
    approvedBy: string;
    /** ISO timestamp. */
    at: string;
    /**
     * The shift whose drawer paid the cash back. Absent when nothing was
     * paid out (GCash only), and never sent to a non-admin.
     */
    payoutShift?: string;
    /** Centavos paid back out of `payoutShift`; never sent to a non-admin. */
    payoutAmount?: number;
}

export const SALE_REVERSAL_VIEW_SHAPE: WireShape<SaleReversalView> = {
    type: 'required',
    reason: 'required',
    approvedBy: 'required',
    at: 'required',
    payoutShift: 'optional',
    payoutAmount: 'optional',
};

/**
 * A stored sale, as `POST /sales/:id/void` and `/refund` return it (the
 * cashier as an id). Fields added over time are absent on older sales.
 * Never the checkout's `idempotencyKey` or `requestHash`: the server keeps
 * those for replays and no response carries them (#27).
 */
export interface SaleView {
    _id: string;
    /** Centavos: the charged total, after any discount. */
    amount: number;
    /** The cashier's user id. */
    cashier: string;
    /** The shift it was rung in; absent on sales from before shifts. */
    shift?: string;
    paymentType: PaymentType;
    /** Digits only; GCASH and SPLIT sales. */
    referenceNumber?: string;
    discount?: SaleDiscountView;
    /** Absent on sales from before tenders were stored. */
    tenders?: Tender[];
    amountTendered?: number;
    changeGiven?: number;
    /** Absent on sales from before statuses: those are COMPLETED. */
    status?: SaleStatus;
    reversal?: SaleReversalView;
    /** ISO timestamps. */
    createdAt: string;
    updatedAt: string;
}

export const SALE_VIEW_SHAPE: WireShape<SaleView> = {
    _id: 'required',
    amount: 'required',
    cashier: 'required',
    shift: 'optional',
    paymentType: 'required',
    referenceNumber: 'optional',
    discount: 'optional',
    tenders: 'optional',
    amountTendered: 'optional',
    changeGiven: 'optional',
    status: 'optional',
    reversal: 'optional',
    createdAt: 'required',
    updatedAt: 'required',
};

/**
 * A row of `GET /sales` (and of the ADMIN dashboard's recent sales): the
 * sale with its cashier's name. `cashier` is null once the user is gone.
 */
export interface SaleRow extends Omit<SaleView, 'cashier'> {
    cashier: UserRef | null;
}

export const SALE_ROW_SHAPE: WireShape<SaleRow> = SALE_VIEW_SHAPE;

/** A line of `GET /sales/details/:id`. */
export interface SaleLine {
    _id: string;
    /** The sale's id. */
    sales: string;
    /** Null once the product is gone. */
    product: ProductRef | null;
    quantity: number;
    /** Centavos, as charged when the sale was rung. */
    unitPrice: number;
}

export const SALE_LINE_SHAPE: WireShape<SaleLine> = {
    _id: 'required',
    sales: 'required',
    product: 'required',
    quantity: 'required',
    unitPrice: 'required',
};
