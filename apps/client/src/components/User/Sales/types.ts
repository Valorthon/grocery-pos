export interface ReceiptItem {
    productName: string;
    quantity: number;
    amount: number;
}

export interface Receipt {
    cashierName: string;
    items: ReceiptItem[];
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
