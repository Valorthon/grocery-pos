import { expect, it } from 'vitest';
import {
    PaymentType,
    SaleStatus,
    type OfflinePendingSale,
} from '@grocery-pos/contracts';
import { requireOfflineConfirmation } from './confirmation';
const soldAt = '2026-11-03T10:00:00.000Z';
const receipt = {
    _id: '0123456789abcdef01234567',
    createdAt: soldAt,
    paymentType: PaymentType.CASH,
    status: SaleStatus.COMPLETED,
    totalAmount: 8100,
    amountTendered: 10000,
    changeGiven: 1900,
};
const entry = { request: { soldAt }, receipt } as OfflinePendingSale;
it('accepts only an exact server record, including an already reversed receipt', () => {
    expect(requireOfflineConfirmation(entry, receipt)).toEqual(receipt);
    expect(
        requireOfflineConfirmation(entry, {
            ...receipt,
            status: SaleStatus.REFUNDED,
        }).status,
    ).toBe(SaleStatus.REFUNDED);
});
it.each([
    null,
    undefined,
    '<html>proxy failure</html>',
    {},
    { ...receipt, _id: 'local-uuid' },
    { ...receipt, createdAt: 'not a date' },
    { ...receipt, createdAt: '2026-11-04T10:00:00.000Z' },
    { ...receipt, paymentType: PaymentType.GCASH },
    { ...receipt, status: 'invalid' },
    { ...receipt, totalAmount: 9000 },
    { ...receipt, amountTendered: 9000 },
    { ...receipt, changeGiven: 9000 },
])('keeps cash pending for an unconfirmed response %#', (value) => {
    expect(() => requireOfflineConfirmation(entry, value)).toThrow(
        'remains pending',
    );
});
