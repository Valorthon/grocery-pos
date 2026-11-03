import {
    PaymentType,
    SaleStatus,
    type OfflinePendingSale,
    type Receipt,
} from '@grocery-pos/contracts';
/** A 2xx/HTML/204 response is not proof that collected cash was recorded. */
export function requireOfflineConfirmation(
    entry: OfflinePendingSale,
    raw: unknown,
): Receipt {
    const receipt = raw as Partial<Receipt> | null;
    if (
        !receipt ||
        typeof receipt !== 'object' ||
        typeof receipt._id !== 'string' ||
        !/^[a-f\d]{24}$/i.test(receipt._id) ||
        typeof receipt.createdAt !== 'string' ||
        Date.parse(receipt.createdAt) !== Date.parse(entry.request.soldAt) ||
        receipt.paymentType !== PaymentType.CASH ||
        !Object.values(SaleStatus).includes(receipt.status as SaleStatus) ||
        receipt.totalAmount !== entry.receipt.totalAmount ||
        receipt.amountTendered !== entry.receipt.amountTendered ||
        receipt.changeGiven !== entry.receipt.changeGiven
    )
        throw new Error(
            'The server did not confirm this exact cash receipt. It remains pending; retry or ask an admin.',
        );
    return receipt as Receipt;
}
