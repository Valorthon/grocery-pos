import {
    billCountTotal,
    CASH_DENOMINATIONS,
    DrawerMovementType,
    PaymentType,
    SaleStatus,
    saleNetCash,
    TenderType,
} from '@grocery-pos/contracts';
import { computeZRead } from './z-read';

describe('saleNetCash', () => {
    it('is the cash tender less change', () => {
        expect(
            saleNetCash({
                paymentType: PaymentType.CASH,
                amount: 45_000,
                tenders: [{ type: TenderType.CASH, amount: 50_000 }],
                changeGiven: 5_000,
            }),
        ).toBe(45_000);
    });

    it('is only the cash part of a split, less change', () => {
        expect(
            saleNetCash({
                paymentType: PaymentType.SPLIT,
                amount: 80_000,
                tenders: [
                    { type: TenderType.CASH, amount: 50_000 },
                    { type: TenderType.GCASH, amount: 50_000 },
                ],
                changeGiven: 20_000,
            }),
        ).toBe(30_000);
    });

    it('is zero for GCash', () => {
        expect(
            saleNetCash({
                paymentType: PaymentType.GCASH,
                amount: 30_000,
                tenders: [{ type: TenderType.GCASH, amount: 30_000 }],
                changeGiven: 0,
            }),
        ).toBe(0);
    });

    it('treats a cash sale stored before tenders as all cash, and GCash as none', () => {
        expect(
            saleNetCash({ paymentType: PaymentType.CASH, amount: 12_345 }),
        ).toBe(12_345);
        expect(
            saleNetCash({ paymentType: PaymentType.GCASH, amount: 12_345 }),
        ).toBe(0);
    });
});

describe('computeZRead', () => {
    it('is just the float for an empty shift', () => {
        const z = computeZRead(
            { openingFloat: 50_000, movements: [] },
            [],
            50_000,
        );

        expect(z.drawer).toMatchObject({ expectedCash: 50_000, overShort: 0 });
        expect(z.sales).toMatchObject({ count: 0, gross: 0, net: 0 });
    });

    it('counts a refund in refunds and nets it out of net sales, not out of cash in', () => {
        const z = computeZRead(
            {
                openingFloat: 0,
                movements: [
                    {
                        type: DrawerMovementType.REVERSAL_PAYOUT,
                        amount: 10_000,
                    },
                ],
            },
            [
                {
                    amount: 10_000,
                    paymentType: PaymentType.CASH,
                    tenders: [{ type: TenderType.CASH, amount: 10_000 }],
                    changeGiven: 0,
                    status: SaleStatus.REFUNDED,
                },
            ],
            0,
        );

        expect(z.sales).toMatchObject({
            gross: 10_000,
            refunds: { count: 1, amount: 10_000 },
            net: 0,
        });
        expect(z.tenders.cash).toBe(10_000);
        expect(z.drawer.expectedCash).toBe(0);
    });

    it('reports an over as positive', () => {
        const z = computeZRead(
            { openingFloat: 10_000, movements: [] },
            [],
            10_500,
        );

        expect(z.drawer.overShort).toBe(500);
    });
});

describe('CASH_DENOMINATIONS', () => {
    it('uses ids that are safe as Mongo field names (no dots, no $)', () => {
        for (const { id } of CASH_DENOMINATIONS) {
            expect(id).not.toMatch(/[.$]/);
        }
        expect(CASH_DENOMINATIONS.map((d) => d.id)).toContain('coin-25c');
    });

    it('counts 25-centavo coins under coin-25c', () => {
        expect(billCountTotal({ 'coin-25c': 3, '1000': 1 })).toBe(100_075);
        expect(billCountTotal({ 'coin-0.25': 3 })).toBe(0);
    });
});
