import {
    DiscountType,
    PaymentType,
    quantityAmount,
    TenderType,
    UnitOfMeasure,
} from '@grocery-pos/contracts';
import type {
    Receipt,
    ReceiptDiscount,
    SaleLine,
} from '@grocery-pos/contracts';

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
export function hasCashTender(
    receipt: Pick<Receipt, 'paymentType' | 'tenders'>,
): boolean {
    return (
        receipt.paymentType === PaymentType.CASH ||
        receipt.tenders.some((t) => t.type === TenderType.CASH)
    );
}

/** The discount's kind on a receipt: its percent, or "Fixed". */
export function discountLabel(discount: ReceiptDiscount): string {
    return discount.type === DiscountType.PERCENT
        ? `${discount.value}%`
        : 'Fixed';
}

/** What Sale Details knows about a stored sale, for its summary (#417). */
export interface StoredSaleSummary {
    id: string;
    cashierName: string;
    /** When the sale happened: an offline sale's `soldAt`, else `createdAt`. */
    occurredAt: string;
    status: Receipt['status'];
    paymentType: Receipt['paymentType'];
    referenceNumber: string | null;
    tenders: Receipt['tenders'];
    changeGiven: number;
    /** Centavos charged, after the discount. */
    amount: number;
    discount: ReceiptDiscount | null;
    storeIdentity?: Receipt['storeIdentity'];
    lines: readonly SaleLine[];
}

/**
 * The on-screen sale summary of a stored sale (#417), from the server's
 * sale and its lines only: the same `Receipt` the register shows after a
 * sale. Line amounts use `quantityAmount` (half up per line), the
 * subtotal is the total plus the discount, as the server charged it.
 */
export function saleSummaryReceipt(sale: StoredSaleSummary): Receipt {
    const discount = sale.discount
        ? {
              type: sale.discount.type,
              value: sale.discount.value,
              reason: sale.discount.reason,
              amount: sale.discount.amount,
          }
        : null;
    // As the server's receipt: unit and unitPrice whenever the line has a unit.
    const items = sale.lines.map((line) => ({
        productName: line.product?.name ?? 'N/A',
        quantity: line.quantity,
        amount: quantityAmount(
            line.unitPrice,
            line.quantity,
            line.unit ?? UnitOfMeasure.PIECE,
        ),
        ...(line.unit ? { unit: line.unit, unitPrice: line.unitPrice } : {}),
    }));
    return {
        ...(sale.storeIdentity ? { storeIdentity: sale.storeIdentity } : {}),
        _id: sale.id,
        createdAt: sale.occurredAt,
        status: sale.status,
        paymentType: sale.paymentType,
        referenceNumber: sale.referenceNumber,
        tenders: [...sale.tenders],
        amountTendered: sale.tenders.reduce((sum, t) => sum + t.amount, 0),
        changeGiven: sale.changeGiven,
        cashierName: sale.cashierName,
        items,
        subtotal: items.reduce((sum, item) => sum + item.amount, 0),
        discount,
        totalAmount: sale.amount,
    };
}
