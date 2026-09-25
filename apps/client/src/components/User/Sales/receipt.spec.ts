import { describe, expect, it } from 'vitest';
import { PaymentType, TenderType } from '@grocery-pos/contracts';
import { hasCashTender, saleNumber } from './receipt';
import type { Receipt } from './types';

describe('saleNumber', () => {
    it('is the last 8 characters of the id, upper case', () => {
        expect(saleNumber('66f3a1b2c3d4e5f6a1b2c3d4')).toBe('A1B2C3D4');
    });

    it('keeps a short id whole, and is empty without one', () => {
        expect(saleNumber('s1')).toBe('S1');
        expect(saleNumber(undefined)).toBe('');
    });
});

describe('hasCashTender', () => {
    const base = { tenders: [] } as unknown as Receipt;

    it('is true for cash and for a split with a cash part', () => {
        expect(hasCashTender({ ...base, paymentType: PaymentType.CASH })).toBe(
            true,
        );
        expect(
            hasCashTender({
                ...base,
                paymentType: PaymentType.SPLIT,
                tenders: [
                    { type: TenderType.GCASH, amount: 100 },
                    { type: TenderType.CASH, amount: 100 },
                ],
            }),
        ).toBe(true);
    });

    it('is false for GCash only', () => {
        expect(
            hasCashTender({
                ...base,
                paymentType: PaymentType.GCASH,
                tenders: [{ type: TenderType.GCASH, amount: 100 }],
            }),
        ).toBe(false);
    });
});
