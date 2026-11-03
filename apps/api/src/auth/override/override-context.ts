import { createHash } from 'node:crypto';
import { OverrideAction, type UnitOfMeasure } from '@grocery-pos/contracts';

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function fingerprint(value: object): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * requestHash covers the normalized ticket, payment and requested discount.
 * Unit prices come from the server both at approval and at checkout. Even
 * price changes which leave the total unchanged therefore need a new PIN.
 */
export function discountApprovalContext(
    idempotencyKey: string,
    requestHash: string,
    pricedLines: readonly {
        product: string;
        quantity: number;
        unitPrice: number;
        unit?: UnitOfMeasure;
    }[],
): string {
    return fingerprint({
        action: OverrideAction.DISCOUNT,
        idempotencyKey,
        requestHash,
        lines: pricedLines
            .map(({ product, quantity, unitPrice, unit }) => ({
                product,
                quantity,
                unitPrice,
                ...(unit && { unit }),
            }))
            .sort(
                (a, b) =>
                    compare(a.product, b.product) ||
                    a.quantity - b.quantity ||
                    a.unitPrice - b.unitPrice,
            ),
    });
}

/** Exact reversal reason, payout destination and stored money being approved. */
export function reversalApprovalContext(input: {
    action: OverrideAction.VOID | OverrideAction.REFUND;
    saleId: string;
    reason: string;
    payoutShiftId: string | null;
    saleShiftId: string | null;
    amount: number;
    netCash: number;
}): string {
    return fingerprint({
        action: input.action,
        saleId: input.saleId,
        reason: input.reason,
        payoutShiftId: input.payoutShiftId,
        saleShiftId: input.saleShiftId,
        amount: input.amount,
        netCash: input.netCash,
    });
}
