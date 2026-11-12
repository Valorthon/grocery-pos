import {
    PurchaseOrderStatus,
    isExpiryDate,
    parseQuantity,
    quantityAmount,
    quantityInput,
    type CreatePurchaseOrderRequest,
    type PurchaseOrderView,
    type ReceivePurchaseOrderRequest,
    type UnitOfMeasure,
} from '@grocery-pos/contracts';
import { NUMERIC_LIMITS } from '@grocery-pos/contracts';
import type { StatusMap } from '@/components/ui/status-badge';
import { statusHelp } from '@/components/ui/column-help';
import type { ColumnHelp } from '@/components/ui/types';
import { centavosToPesoInput, parsePesos } from '@/utils/currency';
import { fieldErrors, moneyError, quantityError } from '@/utils/rules';

/** A PO draft line on the client; name/EAN are for display only. */
export interface PurchaseOrderDraftLine {
    product: string;
    name: string;
    EAN: string;
    unit?: UnitOfMeasure;
    tracksExpiry?: boolean;
    /** Typed display quantity. */
    quantity: string;
    /** Typed pesos. */
    cost: string;
}

export const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
    [PurchaseOrderStatus.DRAFT]: 'Draft',
    [PurchaseOrderStatus.SENT]: 'Sent',
    [PurchaseOrderStatus.PARTIALLY_RECEIVED]: 'Partially received',
    [PurchaseOrderStatus.RECEIVED]: 'Received',
    [PurchaseOrderStatus.CANCELLED]: 'Cancelled',
};

/** A purchase order's status badge (#243). */
export const PURCHASE_ORDER_STATUS: StatusMap<PurchaseOrderStatus> = {
    [PurchaseOrderStatus.DRAFT]: { label: 'Draft', color: 'neutral' },
    [PurchaseOrderStatus.SENT]: { label: 'Sent', color: 'warning' },
    [PurchaseOrderStatus.PARTIALLY_RECEIVED]: {
        label: 'Partially received',
        color: 'warning',
    },
    [PurchaseOrderStatus.RECEIVED]: { label: 'Received', color: 'success' },
    [PurchaseOrderStatus.CANCELLED]: { label: 'Cancelled', color: 'error' },
};

export function draftLinesOf(po: PurchaseOrderView): PurchaseOrderDraftLine[] {
    return po.lines.map((line) => ({
        product: line.product,
        name: line.name,
        EAN: line.EAN,
        unit: line.unit,
        tracksExpiry: line.tracksExpiry,
        quantity: quantityInput(line.orderedQty, line.unit),
        cost: centavosToPesoInput(line.expectedCost),
    }));
}

/** Errors by line index then field; empty when every line is valid. */
export function draftLineErrors(
    lines: PurchaseOrderDraftLine[],
): Record<number, Record<string, string>> {
    const out: Record<number, Record<string, string>> = {};
    lines.forEach((line, index) => {
        const errors = fieldErrors({
            quantity: quantityError(line.quantity, line.unit),
            cost: moneyError(line.cost, NUMERIC_LIMITS.UNIT_COST_MIN),
        });
        if (Object.keys(errors).length) out[index] = errors;
    });
    return out;
}

/** `POST /purchase-orders` (and PATCH, plus version) body. */
export function toPurchaseOrderBody(
    supplier: string,
    note: string,
    lines: PurchaseOrderDraftLine[],
): CreatePurchaseOrderRequest {
    const trimmed = note.trim();
    return {
        supplier,
        ...(trimmed && { note: trimmed }),
        lines: lines.map((line) => ({
            product: line.product,
            orderedQty: parseQuantity(line.quantity, line.unit) ?? 0,
            expectedCost: parsePesos(line.cost) ?? 0,
        })),
    };
}

export function draftTotal(lines: PurchaseOrderDraftLine[]): number {
    return lines.reduce((sum, line) => {
        const qty = parseQuantity(line.quantity, line.unit);
        const cost = parsePesos(line.cost);
        return qty && cost !== null
            ? sum + quantityAmount(cost, qty, line.unit)
            : sum;
    }, 0);
}

/** One receive-form line: prefilled with the outstanding qty and expected cost. */
export interface ReceiptFormLine {
    line: string;
    name: string;
    EAN: string;
    unit: UnitOfMeasure;
    tracksExpiry: boolean;
    outstandingQty: number;
    expectedCost: number;
    quantity: string;
    cost: string;
    expiryDate: string;
    batchNo: string;
}

export function receiptForm(po: PurchaseOrderView): ReceiptFormLine[] {
    return po.lines
        .filter((line) => line.outstandingQty > 0)
        .map((line) => ({
            line: line._id,
            name: line.name,
            EAN: line.EAN,
            unit: line.unit,
            tracksExpiry: line.tracksExpiry,
            outstandingQty: line.outstandingQty,
            expectedCost: line.expectedCost,
            quantity: quantityInput(line.outstandingQty, line.unit),
            cost: centavosToPesoInput(line.expectedCost),
            expiryDate: '',
            batchNo: '',
        }));
}

/** Actual minus expected unit cost, in centavos; null while the cost is invalid. */
export function costVariance(line: ReceiptFormLine): number | null {
    const cost = parsePesos(line.cost);
    return cost === null ? null : cost - line.expectedCost;
}

/**
 * A blank or zero quantity skips the line. Over-receipt is refused here as
 * on the server: extra goods go through a normal restock.
 */
export function receiptErrors(
    lines: ReceiptFormLine[],
): Record<number, Record<string, string>> {
    const out: Record<number, Record<string, string>> = {};
    lines.forEach((line, index) => {
        if (isSkipped(line)) return;
        const qty = parseQuantity(line.quantity, line.unit);
        const errors = fieldErrors({
            quantity:
                quantityError(line.quantity, line.unit) ||
                (qty !== null && qty > line.outstandingQty
                    ? `At most ${quantityInput(line.outstandingQty, line.unit)} outstanding`
                    : ''),
            cost: moneyError(line.cost, NUMERIC_LIMITS.UNIT_COST_MIN),
            expiryDate:
                line.tracksExpiry && !isExpiryDate(line.expiryDate)
                    ? 'Choose a valid expiry date.'
                    : '',
        });
        if (Object.keys(errors).length) out[index] = errors;
    });
    return out;
}

function isSkipped(line: ReceiptFormLine): boolean {
    const text = line.quantity.trim();
    return text === '' || parseQuantity(text, line.unit) === 0;
}

export function receivedLines(lines: ReceiptFormLine[]): ReceiptFormLine[] {
    return lines.filter((line) => !isSkipped(line));
}

export function toReceiveBody(
    po: Pick<PurchaseOrderView, 'version'>,
    idempotencyKey: string,
    lines: ReceiptFormLine[],
    invoiceNumber: string,
    description: string,
): ReceivePurchaseOrderRequest {
    return {
        version: po.version,
        idempotencyKey,
        ...(invoiceNumber.trim() && { invoiceNumber: invoiceNumber.trim() }),
        ...(description.trim() && { description: description.trim() }),
        lines: receivedLines(lines).map((line) => ({
            line: line.line,
            quantity: parseQuantity(line.quantity, line.unit) ?? 0,
            unitCost: parsePesos(line.cost) ?? 0,
            ...(line.tracksExpiry && { expiryDate: line.expiryDate }),
            ...(line.tracksExpiry &&
                line.batchNo.trim() && { batchNo: line.batchNo.trim() }),
        })),
    };
}

/** A fresh receive-attempt key, reused by retries until the receive lands. */
export function newReceiveKey(): string {
    return `po-${crypto.randomUUID()}`;
}

/** Column and field help for purchase orders (#263, #288). */
export const PURCHASE_ORDER_HELP = {
    status: statusHelp(PURCHASE_ORDER_STATUS, {
        [PurchaseOrderStatus.DRAFT]: 'Editable, not yet sent.',
        [PurchaseOrderStatus.SENT]: 'Lines locked, awaiting delivery.',
        [PurchaseOrderStatus.PARTIALLY_RECEIVED]:
            'Some stock received, the rest outstanding.',
        [PurchaseOrderStatus.RECEIVED]: 'Everything ordered was received.',
        [PurchaseOrderStatus.CANCELLED]:
            'Closed; stock already received stays.',
    }),
    lines: 'Number of products on the order (one line per product).',
    expectedTotal:
        'Ordered quantity × expected cost, summed over the lines. The cost entered at receipt may differ.',
    /** Shared by the Add product dialog and the Lines table (#288). */
    ordered:
        "How much you're ordering from the supplier, in the product's unit. Stock doesn't change until you receive it.",
    expectedCost:
        'What you expect to pay per unit. Prefilled from the latest receipt; you confirm the real cost when receiving.',
} satisfies Record<string, ColumnHelp>;
