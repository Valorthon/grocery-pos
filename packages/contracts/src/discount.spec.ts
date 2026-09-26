import { describe, expect, it } from 'vitest';
import { DiscountType, discountAmount } from './discount.js';

describe('discountAmount', () => {
    it('takes a whole percent of the subtotal', () => {
        expect(
            discountAmount(10_000, { type: DiscountType.PERCENT, value: 10 }),
        ).toBe(1_000);
        expect(
            discountAmount(10_000, { type: DiscountType.PERCENT, value: 100 }),
        ).toBe(10_000);
    });

    it('rounds a percent half-up to the centavo', () => {
        // 5% of 1,010 is 50.5 → 51; 5% of 1,009 is 50.45 → 50.
        expect(
            discountAmount(1_010, { type: DiscountType.PERCENT, value: 5 }),
        ).toBe(51);
        expect(
            discountAmount(1_009, { type: DiscountType.PERCENT, value: 5 }),
        ).toBe(50);
    });

    it('can round a percent of a tiny subtotal to 0', () => {
        expect(
            discountAmount(1, { type: DiscountType.PERCENT, value: 1 }),
        ).toBe(0);
    });

    it('stays exact on large subtotals (integer arithmetic)', () => {
        // ₱10,000,000 at 33%: no floating-point drift.
        expect(
            discountAmount(1_000_000_000, {
                type: DiscountType.PERCENT,
                value: 33,
            }),
        ).toBe(330_000_000);
    });

    it('returns a fixed amount as-is, even above the subtotal', () => {
        expect(
            discountAmount(10_000, { type: DiscountType.FIXED, value: 2_500 }),
        ).toBe(2_500);
        expect(
            discountAmount(100, { type: DiscountType.FIXED, value: 2_500 }),
        ).toBe(2_500);
    });
});
