import { describe, expect, it } from 'vitest';
import {
    DiscountType,
    NUMERIC_LIMITS,
    PaymentType,
    TenderType,
} from '@grocery-pos/contracts';
import {
    buildPayment,
    cashTender,
    fixedDiscountError,
    previewSale,
    QUICK_CASH_STEPS,
    quickCashAmounts,
    referenceNumberError,
    splitTender,
} from './checkout';
import { centavosToPesoInput, formatCurrency } from '@/utils/currency';

/**
 * The same cases the API's SalesService is tested against
 * (apps/api/src/sales/sales.service.spec.ts), so the preview the cashier
 * tenders against matches what the server charges, to the centavo.
 */
const SHARED_DISCOUNT_CASES = [
    { subtotal: 100000, type: DiscountType.PERCENT, value: 20, amount: 20000 },
    { subtotal: 12990, type: DiscountType.PERCENT, value: 15, amount: 1949 },
    // 5% of 1,010 is 50.5 centavos: half-up gives 51.
    { subtotal: 1010, type: DiscountType.PERCENT, value: 5, amount: 51 },
    // 5% of 1,009 is 50.45 centavos: rounds down to 50.
    { subtotal: 1009, type: DiscountType.PERCENT, value: 5, amount: 50 },
    { subtotal: 5000, type: DiscountType.FIXED, value: 1250, amount: 1250 },
] as const;

/** Cases both sides refuse: the server with a 400, the preview as not chargeable. */
const SHARED_REJECTED_CASES = [
    // 5% of 9 centavos is 0.45: the discount rounds to nothing.
    { subtotal: 9, type: DiscountType.PERCENT, value: 5 },
    { subtotal: 5000, type: DiscountType.FIXED, value: 5001 },
    { subtotal: 5000, type: DiscountType.FIXED, value: 5000 },
    { subtotal: 5000, type: DiscountType.PERCENT, value: 100 },
] as const;

describe('checkout preview', () => {
    it.each(SHARED_DISCOUNT_CASES)(
        '$type $value off $subtotal takes off $amount centavos, like the server',
        ({ subtotal, type, value, amount }) => {
            expect(previewSale(subtotal, { type, value })).toEqual({
                subtotal,
                discountAmount: amount,
                total: subtotal - amount,
                isChargeable: true,
            });
        },
    );

    it('is the subtotal when there is no discount', () => {
        expect(previewSale(4200, null)).toMatchObject({
            discountAmount: 0,
            total: 4200,
        });
    });

    it.each(SHARED_REJECTED_CASES)(
        'flags $type $value off $subtotal as not chargeable, like the server',
        ({ subtotal, type, value }) => {
            expect(previewSale(subtotal, { type, value }).isChargeable).toBe(
                false,
            );
        },
    );
});

describe('cash checkout', () => {
    // 15% off ₱129.90: as pesos in doubles the total was an unrounded
    // 110.415, so tendering the ₱110.41 on screen left Confirm disabled.
    const { total } = previewSale(12990, {
        type: DiscountType.PERCENT,
        value: 15,
    });

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

describe('building the tender breakdown', () => {
    const REF = '1234567890123';
    const TOTAL = 100000;

    it('sends cash handed over as a single CASH tender, change left to the server', () => {
        expect(
            buildPayment(PaymentType.CASH, TOTAL, {
                cash: '1500',
                referenceNumber: '',
            }),
        ).toEqual({
            paymentType: PaymentType.CASH,
            tenders: [{ type: TenderType.CASH, amount: 150000 }],
        });
    });

    it('never sends a reference number with a cash sale', () => {
        expect(
            buildPayment(PaymentType.CASH, TOTAL, {
                cash: '1000',
                referenceNumber: REF,
            }),
        ).not.toHaveProperty('referenceNumber');
    });

    it('holds a cash sale that is a centavo short', () => {
        expect(
            buildPayment(PaymentType.CASH, TOTAL, {
                cash: '999.99',
                referenceNumber: '',
            }),
        ).toBeNull();
    });

    it('sends GCash for exactly the total with the normalized reference', () => {
        expect(
            buildPayment(PaymentType.GCASH, TOTAL, {
                cash: '',
                referenceNumber: '1234 567 890123',
            }),
        ).toEqual({
            paymentType: PaymentType.GCASH,
            tenders: [{ type: TenderType.GCASH, amount: TOTAL }],
            referenceNumber: REF,
        });
    });

    it.each(['', 'x', '123456789012', '12345678901234', '12345678901ab'])(
        'holds GCash with the reference %j',
        (referenceNumber) => {
            expect(
                buildPayment(PaymentType.GCASH, TOTAL, {
                    cash: '',
                    referenceNumber,
                }),
            ).toBeNull();
            expect(referenceNumberError(referenceNumber)).not.toBeNull();
        },
    );

    it('accepts a 13-digit reference', () => {
        expect(referenceNumberError('1234 567 890123')).toBeNull();
    });

    it('sends a ₱500 + ₱500 split as SPLIT with both tenders', () => {
        expect(
            buildPayment(PaymentType.SPLIT, TOTAL, {
                cash: '500',
                referenceNumber: REF,
            }),
        ).toEqual({
            paymentType: PaymentType.SPLIT,
            tenders: [
                { type: TenderType.CASH, amount: 50000 },
                { type: TenderType.GCASH, amount: 50000 },
            ],
            referenceNumber: REF,
        });
    });

    it('holds a split without cash or without a valid reference', () => {
        expect(
            buildPayment(PaymentType.SPLIT, TOTAL, {
                cash: '',
                referenceNumber: REF,
            }),
        ).toBeNull();
        expect(
            buildPayment(PaymentType.SPLIT, TOTAL, {
                cash: '500',
                referenceNumber: 'x',
            }),
        ).toBeNull();
    });

    it('sends a split whose cash covers everything as a cash sale', () => {
        expect(
            buildPayment(PaymentType.SPLIT, TOTAL, {
                cash: '1200',
                referenceNumber: '',
            }),
        ).toEqual({
            paymentType: PaymentType.CASH,
            tenders: [{ type: TenderType.CASH, amount: 120000 }],
        });
    });
});

describe('quick cash (decision 2026-09-25, #23)', () => {
    const pesos = (list: number[]) => list.map((c) => c / 100);

    it.each([
        // The product owner's example.
        [118000, [1200, 1500, 2000]],
        [3500, [50, 100, 500, 1000]],
        [9975, [100, 500, 1000]],
        [234000, [2350, 2400, 2500, 3000]],
        // An exact note already: the next amounts up, never the total.
        [100000, [1050, 1100, 1500, 2000]],
        [2000, [50, 100, 500, 1000]],
        [1, [50, 100, 500, 1000]],
        // Every note rounds ₱990 up to ₱1,000.
        [99000, [1000]],
        // ₱20 is offered when it is one of the few distinct amounts.
        [196000, [1980, 2000]],
    ])('offers the next likely amounts for %i centavos', (total, expected) => {
        expect(pesos(quickCashAmounts(total))).toEqual(expected);
    });

    it('is 1 to 4 distinct amounts, all above the total, rounded to a note step, ascending', () => {
        for (let total = 1; total <= 1_500_000; total += 3_337) {
            const amounts = quickCashAmounts(total);
            expect(amounts.length).toBeGreaterThanOrEqual(1);
            expect(amounts.length).toBeLessThanOrEqual(4);
            expect(new Set(amounts).size).toBe(amounts.length);
            expect([...amounts].sort((a, b) => a - b)).toEqual(amounts);
            for (const amount of amounts) {
                expect(amount).toBeGreaterThan(total);
                expect(
                    QUICK_CASH_STEPS.some((step) => amount % step === 0),
                ).toBe(true);
            }
        }
    });

    it('offers nothing for no total, and nothing above AMOUNT_MAX', () => {
        expect(quickCashAmounts(0)).toEqual([]);
        expect(quickCashAmounts(-500)).toEqual([]);
        expect(quickCashAmounts(Number.NaN)).toEqual([]);
        expect(quickCashAmounts(NUMERIC_LIMITS.AMOUNT_MAX)).toEqual([]);
    });
});

describe('split tender (#23)', () => {
    it('leaves GCash the rest and no change while the cash is short', () => {
        expect(splitTender(100000, '300')).toEqual({
            cash: 30000,
            gcash: 70000,
            changeDue: 0,
            coversTotal: false,
        });
    });

    it('shows the change when the cash alone covers the total', () => {
        expect(splitTender(100000, '1500')).toEqual({
            cash: 150000,
            gcash: 0,
            changeDue: 50000,
            coversTotal: true,
        });
    });
});

describe('fixed discount (#52 follow-up, #23)', () => {
    it('accepts an amount up to a centavo under the subtotal', () => {
        expect(fixedDiscountError('15', 5000)).toBe('');
        expect(fixedDiscountError('49.99', 5000)).toBe('');
    });

    it.each([
        ['', 'This field is required'],
        ['abc', 'Enter an amount in pesos, up to 2 decimals'],
        ['1.005', 'Enter an amount in pesos, up to 2 decimals'],
        ['0', 'Enter at least ₱0.01'],
        ['50.01', "Can't be more than the subtotal (₱50.00)"],
        ['50', 'Must leave something to charge'],
    ])('refuses %j', (input, message) => {
        expect(fixedDiscountError(input, 5000)).toBe(message);
    });

    it('agrees with the preview on what is chargeable', () => {
        for (const input of ['49.99', '50', '50.01']) {
            const value = Math.round(Number(input) * 100);
            expect(fixedDiscountError(input, 5000) === '').toBe(
                previewSale(5000, { type: DiscountType.FIXED, value })
                    .isChargeable,
            );
        }
    });
});
