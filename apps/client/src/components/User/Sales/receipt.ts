import { PaymentType, TenderType } from '@grocery-pos/contracts';
import type { Receipt } from './types';

/** Characters of the sale id shown as its number on the receipt. */
export const SALE_NUMBER_LENGTH = 8;

/**
 * The sale's number on the receipt: the last 8 characters of its id, upper
 * case. A Mongo ObjectId ends in an incrementing counter, so sales created
 * one after another by the server do not share it; the full id is shown
 * beside it, so the number is never the only way to find the sale.
 */
export function saleNumber(id: string | null | undefined): string {
    if (!id) return '';
    return id.slice(-SALE_NUMBER_LENGTH).toUpperCase();
}

/**
 * Whether the receipt has a Change line: any sale with a cash tender, even
 * when the change is ₱0.00 (exact cash). A GCash-only sale gives none.
 */
export function hasCashTender(receipt: Receipt): boolean {
    return (
        receipt.paymentType === PaymentType.CASH ||
        receipt.tenders.some((t) => t.type === TenderType.CASH)
    );
}
