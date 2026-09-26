import type { PaymentType, Tender } from '@grocery-pos/contracts';

/** The payment part of the `POST /sales` body, built by the checkout modal. */
export interface PaymentRequest {
    paymentType: PaymentType;
    tenders: Tender[];
    /** Digits only; sent for GCASH and SPLIT, never for CASH. */
    referenceNumber?: string;
}
