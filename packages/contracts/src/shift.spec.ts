import { describe, expect, it } from 'vitest';
import { PaymentType } from './enums';
import { TenderType } from './sales';
import {
    CASH_DENOMINATIONS,
    billCountTotal,
    isDenomination,
    saleNetCash,
} from './shift';

describe('CASH_DENOMINATIONS', () => {
    it('has unique, dot-free ids and positive centavo values', () => {
        const ids = CASH_DENOMINATIONS.map((d) => d.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const d of CASH_DENOMINATIONS) {
            expect(d.id).not.toContain('.');
            expect(Number.isInteger(d.value) && d.value > 0).toBe(true);
        }
    });
});

describe('isDenomination', () => {
    it('knows the listed ids only', () => {
        expect(isDenomination('1000')).toBe(true);
        expect(isDenomination('coin-25c')).toBe(true);
        expect(isDenomination('2000')).toBe(false);
    });
});

describe('billCountTotal', () => {
    it('adds up bills and coins in centavos', () => {
        expect(
            billCountTotal({ '1000': 2, '100': 3, 'coin-1': 4, 'coin-25c': 3 }),
        ).toBe(200_000 + 30_000 + 400 + 75);
    });

    it('ignores unknown ids and non-positive or fractional counts', () => {
        expect(
            billCountTotal({
                '1000': 1,
                '2000': 5,
                '500': -1,
                '200': 0,
                '100': 1.5,
            }),
        ).toBe(100_000);
    });

    it('is 0 for an empty count', () => {
        expect(billCountTotal({})).toBe(0);
    });
});

describe('saleNetCash', () => {
    it('is the whole amount for a legacy CASH sale without tenders', () => {
        expect(
            saleNetCash({ paymentType: PaymentType.CASH, amount: 5_000 }),
        ).toBe(5_000);
        expect(
            saleNetCash({
                paymentType: PaymentType.CASH,
                amount: 5_000,
                tenders: [],
            }),
        ).toBe(5_000);
    });

    it('is 0 for a legacy GCash sale without tenders', () => {
        expect(
            saleNetCash({ paymentType: PaymentType.GCASH, amount: 5_000 }),
        ).toBe(0);
    });

    it('is cash tendered less change', () => {
        expect(
            saleNetCash({
                paymentType: PaymentType.CASH,
                amount: 4_250,
                tenders: [{ type: TenderType.CASH, amount: 5_000 }],
                changeGiven: 750,
            }),
        ).toBe(4_250);
    });

    it('counts only the cash part of a SPLIT sale', () => {
        expect(
            saleNetCash({
                paymentType: PaymentType.SPLIT,
                amount: 10_000,
                tenders: [
                    { type: TenderType.CASH, amount: 4_000 },
                    { type: TenderType.GCASH, amount: 6_000 },
                ],
                changeGiven: 0,
            }),
        ).toBe(4_000);
    });

    it('is 0 for a GCash-only sale, whatever the change field says', () => {
        expect(
            saleNetCash({
                paymentType: PaymentType.GCASH,
                amount: 3_000,
                tenders: [{ type: TenderType.GCASH, amount: 3_000 }],
                changeGiven: null,
            }),
        ).toBe(0);
    });
});
