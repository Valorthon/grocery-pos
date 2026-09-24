import { describe, expect, it } from 'vitest';
import { cashTender, discountedTotal } from './checkout';
import { centavosToPesoInput, formatCurrency } from '@/utils/currency';

describe('cash checkout', () => {
    // 15% off ₱129.90: as pesos in doubles the total was an unrounded
    // 110.415, so tendering the ₱110.41 on screen left Confirm disabled.
    const total = discountedTotal(12990, 15);

    it('rounds the discounted total to the centavo shown on screen', () => {
        expect(total).toBe(11041);
        expect(formatCurrency(total)).toBe('₱110.41');
    });

    it('accepts tendering exactly the displayed total', () => {
        const typed = formatCurrency(total).replace('₱', '');

        expect(cashTender(total, typed)).toEqual({
            tendered: 11041,
            changeDue: 0,
            isSufficient: true,
        });
        // The "Exact" button pre-fills the same value.
        expect(cashTender(total, centavosToPesoInput(total)).isSufficient).toBe(
            true,
        );
    });

    it('rejects a centavo short and gives exact change when over', () => {
        expect(cashTender(total, '110.40').isSufficient).toBe(false);
        expect(cashTender(total, '200').changeDue).toBe(8959);
    });
});
