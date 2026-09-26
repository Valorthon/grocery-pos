import { REFERENCE_NUMBER_LIMITS } from './limits.js';

/**
 * Lifecycle of a sale. Only COMPLETED sales count toward revenue; a sale
 * without a status (written before statuses existed) is COMPLETED.
 */
export enum SaleStatus {
    COMPLETED = 'COMPLETED',
    /** Reversed because it was rung up by mistake. */
    VOIDED = 'VOIDED',
    /** Reversed because the customer returned the goods. */
    REFUNDED = 'REFUNDED',
}

/**
 * How a sale was reversed. Void and refund do the same thing to the data
 * (status, stock back to inventory, out of revenue); they differ only in
 * meaning: VOID is a mis-ring, REFUND is a customer return.
 */
export enum ReversalType {
    VOID = 'VOID',
    REFUND = 'REFUND',
}

export const REVERSAL_STATUS: Record<ReversalType, SaleStatus> = {
    [ReversalType.VOID]: SaleStatus.VOIDED,
    [ReversalType.REFUND]: SaleStatus.REFUNDED,
};

/** Statuses that take a sale out of revenue and cannot be reversed again. */
export const REVERSED_SALE_STATUSES: readonly SaleStatus[] = [
    SaleStatus.VOIDED,
    SaleStatus.REFUNDED,
];

/** One way of paying within a sale. SPLIT is one CASH plus one GCASH tender. */
export enum TenderType {
    CASH = 'CASH',
    GCASH = 'GCASH',
}

/**
 * One tender as the client sends it and the server records it, in centavos.
 * For CASH, `amount` is what the customer handed over and may exceed what is
 * due (the excess is change). For GCASH it is what was transferred and never
 * exceeds the sale total.
 */
export interface Tender {
    type: TenderType;
    amount: number;
}

/** Removes the spaces GCash prints between digit groups. */
export function normalizeReferenceNumber(value: string): string {
    return value.replace(/\s+/g, '');
}

/** True for a (normalized) GCash reference number the API will accept. */
export function isValidReferenceNumber(value: string): boolean {
    return (
        value.length >= REFERENCE_NUMBER_LIMITS.MIN_LENGTH &&
        value.length <= REFERENCE_NUMBER_LIMITS.MAX_LENGTH &&
        REFERENCE_NUMBER_LIMITS.PATTERN.test(value)
    );
}
