import type {
    DiscountType,
    PaymentType,
    ReversalType,
    SaleStatus,
    Tender,
} from '@grocery-pos/contracts';

// Every money field below is integer centavos.
export interface ReceiptItem {
    productName: string;
    quantity: number;
    amount: number;
}

export interface ReceiptDiscount {
    type: DiscountType;
    value: number;
    reason: string;
    amount: number;
}

/** `POST /sales` response: every total here is the server's, not a copy. */
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
    amountTendered: number;
    /** Paid out of the cash tender. */
    changeGiven: number;
    cashierName: string;
    items: ReceiptItem[];
    subtotal: number;
    discount: ReceiptDiscount | null;
    totalAmount: number;
}

/** The payment part of the `POST /sales` body, built by the checkout modal. */
export interface PaymentRequest {
    paymentType: PaymentType;
    tenders: Tender[];
    /** Digits only; sent for GCASH and SPLIT, never for CASH. */
    referenceNumber?: string;
}

export interface SaleReversal {
    type: ReversalType;
    reason: string;
    approvedBy: string;
    at: string;
}
