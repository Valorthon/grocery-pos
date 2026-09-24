import { PaymentType, TenderType } from './types/sales.types';
import { ErrorCode, ValidationError } from '../common/errors';

export interface TenderLine {
    type: TenderType;
    amount: number;
}

export interface Settlement {
    tenders: TenderLine[];
    /** Centavos: the sum of the tenders. */
    amountTendered: number;
    /** Centavos: what the drawer pays back, always out of the cash tender. */
    changeGiven: number;
}

/** The tender types each payment type must carry, exactly once each. */
const REQUIRED_TENDERS: Record<PaymentType, TenderType[]> = {
    [PaymentType.CASH]: [TenderType.CASH],
    [PaymentType.GCASH]: [TenderType.GCASH],
    [PaymentType.SPLIT]: [TenderType.CASH, TenderType.GCASH],
};

function invalid(message: string, details: unknown): never {
    throw new ValidationError(
        ErrorCode.VALIDATION_INVALID_INPUT,
        message,
        details,
    );
}

/**
 * Checks the tenders against the total the server charged and works out the
 * change. All amounts are centavos.
 *
 * - The tenders match the payment type: CASH is one cash tender, GCASH one
 *   GCash tender, SPLIT one of each.
 * - A GCash tender never exceeds the total: only cash can be over-tendered.
 * - For SPLIT the GCash part is less than the total, so the cash part pays
 *   for something; a GCash transfer that covers everything is a GCASH sale.
 * - Together the tenders cover the total; any excess is change from cash.
 */
export function settleTenders(
    paymentType: PaymentType,
    tenders: TenderLine[],
    total: number,
): Settlement {
    const required = REQUIRED_TENDERS[paymentType];
    const types = tenders.map((t) => t.type);
    const matches =
        types.length === required.length &&
        required.every((type) => types.includes(type));

    if (!matches) {
        invalid(
            `A ${paymentType} sale must be paid with ${required.join(' + ')}`,
            {
                paymentType,
                tenders: types,
            },
        );
    }

    const gcash = tenders.find((t) => t.type === TenderType.GCASH)?.amount ?? 0;
    const amountTendered = tenders.reduce((sum, t) => sum + t.amount, 0);

    if (gcash > total) {
        invalid('The GCash amount cannot exceed the total', { total, gcash });
    }

    if (paymentType === PaymentType.SPLIT && gcash >= total) {
        invalid('A split sale must be paid partly in cash', { total, gcash });
    }

    if (amountTendered < total) {
        invalid('The tendered amount does not cover the total', {
            total,
            amountTendered,
        });
    }

    return {
        tenders: tenders.map(({ type, amount }) => ({ type, amount })),
        amountTendered,
        changeGiven: amountTendered - total,
    };
}
