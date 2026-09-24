import type { DiscountType } from '@grocery-pos/contracts';

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
    cashierName: string;
    items: ReceiptItem[];
    subtotal: number;
    discount: ReceiptDiscount | null;
    totalAmount: number;
}

export interface SplitDetails {
    cashAmount: number;
    onlineAmount: number;
    cashTendered: number;
    cashChange: number;
    referenceNumber: string;
    onlineMethod: string;
}

export type PaymentMethod = 'CASH' | 'GCASH' | 'SPLIT';

export interface PaymentInfo {
    method: PaymentMethod;
    amountTendered?: number;
    changeDue?: number;
    referenceNumber?: string;
    split?: SplitDetails;
}
