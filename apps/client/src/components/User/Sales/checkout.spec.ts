import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
    DiscountType,
    PaymentType,
    SaleStatus,
    TenderType,
} from '@grocery-pos/contracts';
import {
    buildPayment,
    cashTender,
    drawerCashAmount,
    previewSale,
    referenceNumberError,
} from './checkout';
import type { Receipt } from './types';
import { centavosToPesoInput, formatCurrency } from '@/utils/currency';
import { useShiftStore } from '@/stores/shift';

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

describe('drawer expectation after a sale', () => {
    // A server receipt whose figures differ from anything the client typed:
    // the drawer must follow the server.
    function receipt(
        paymentType: PaymentType,
        tenders: Receipt['tenders'],
        changeGiven: number,
    ): Receipt {
        return {
            _id: 'sale1',
            createdAt: '2026-09-24T02:00:00.000Z',
            status: SaleStatus.COMPLETED,
            paymentType,
            referenceNumber:
                paymentType === PaymentType.CASH ? null : '1234567890123',
            tenders,
            amountTendered: tenders.reduce((sum, t) => sum + t.amount, 0),
            changeGiven,
            cashierName: 'ana',
            items: [{ productName: 'basket', quantity: 1, amount: 100000 }],
            subtotal: 100000,
            discount: {
                type: DiscountType.PERCENT,
                value: 20,
                reason: 'loyalty',
                amount: 20000,
            },
            totalAmount: 80000,
        };
    }

    beforeEach(() => {
        localStorage.clear();
        setActivePinia(createPinia());
    });

    it('keeps the cash tendered less the server’s change for a cash sale', () => {
        const sale = receipt(
            PaymentType.CASH,
            [{ type: TenderType.CASH, amount: 100000 }],
            20000,
        );
        const shift = useShiftStore();
        shift.startShift('ana', 'T1', {}, 0);

        shift.recordCashSale(drawerCashAmount(sale));

        expect(shift.currentDrawerCash).toBe(80000);
    });

    it('keeps only the cash part of a split sale', () => {
        // ₱800 total: ₱500 GCash, ₱500 bill for the rest, ₱200 change.
        const sale = receipt(
            PaymentType.SPLIT,
            [
                { type: TenderType.CASH, amount: 50000 },
                { type: TenderType.GCASH, amount: 50000 },
            ],
            20000,
        );

        expect(drawerCashAmount(sale)).toBe(30000);
    });

    it('puts no cash in the drawer for GCash', () => {
        expect(
            drawerCashAmount(
                receipt(
                    PaymentType.GCASH,
                    [{ type: TenderType.GCASH, amount: 80000 }],
                    0,
                ),
            ),
        ).toBe(0);
    });
});
