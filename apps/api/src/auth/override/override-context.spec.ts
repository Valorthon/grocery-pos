import { OverrideAction } from '@grocery-pos/contracts';
import {
    discountApprovalContext,
    reversalApprovalContext,
} from './override-context';

describe('manager approval context', () => {
    const lines = [
        { product: 'b', quantity: 2, unitPrice: 100 },
        { product: 'a', quantity: 1, unitPrice: 200 },
    ];

    it('accepts equivalent line ordering without changing the approved action', () => {
        expect(discountApprovalContext('key', 'request', lines)).toBe(
            discountApprovalContext('key', 'request', [...lines].reverse()),
        );
    });

    it('requires approval again if individual prices change even when the subtotal does not', () => {
        const changed = [
            { product: 'b', quantity: 2, unitPrice: 150 },
            { product: 'a', quantity: 1, unitPrice: 100 },
        ];
        expect(discountApprovalContext('key', 'request', lines)).not.toBe(
            discountApprovalContext('key', 'request', changed),
        );
    });

    it('does not transfer a discount approval to another checkout attempt or request', () => {
        const original = discountApprovalContext('key', 'request', lines);
        expect(discountApprovalContext('other', 'request', lines)).not.toBe(
            original,
        );
        expect(discountApprovalContext('key', 'other', lines)).not.toBe(
            original,
        );
    });

    const reversal = {
        action: OverrideAction.VOID as const,
        saleId: 'sale',
        reason: 'Mis-ring',
        payoutShiftId: null,
        saleShiftId: 'shift',
        amount: 500,
        netCash: 200,
    };

    it.each([
        { action: OverrideAction.REFUND as const },
        { saleId: 'other' },
        { reason: 'Different reason' },
        { payoutShiftId: 'other-drawer' },
        { saleShiftId: 'other-shift' },
        { amount: 600 },
        { netCash: 300 },
    ])(
        'does not transfer reversal approval across changed context %j',
        (change) => {
            expect(
                reversalApprovalContext({ ...reversal, ...change }),
            ).not.toBe(reversalApprovalContext(reversal));
        },
    );
});
