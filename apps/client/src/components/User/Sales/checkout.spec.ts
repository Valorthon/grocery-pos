import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { DiscountType } from '@grocery-pos/contracts';
import { cashTender, drawerCashAmount, previewSale } from './checkout';
import type { PaymentInfo, Receipt } from './types';
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

    it('flags discounts the server would reject', () => {
        const fixed = { type: DiscountType.FIXED, value: 5000 };
        const all = { type: DiscountType.PERCENT, value: 100 };

        expect(previewSale(5000, fixed).isChargeable).toBe(false);
        expect(previewSale(4999, fixed).isChargeable).toBe(false);
        expect(previewSale(5000, all).isChargeable).toBe(false);
    });
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

describe('drawer expectation after a sale', () => {
    // A server receipt whose total differs from any client-side copy: the
    // drawer must follow the server.
    const receipt: Receipt = {
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

    beforeEach(() => {
        localStorage.clear();
        setActivePinia(createPinia());
    });

    it('records the server total for a cash sale', () => {
        const payment: PaymentInfo = {
            method: 'CASH',
            amountTendered: 100000,
            changeDue: 20000,
        };
        const shift = useShiftStore();
        shift.startShift('ana', 'T1', {}, 0);

        shift.recordCashSale(drawerCashAmount(payment, receipt));

        expect(shift.currentDrawerCash).toBe(80000);
    });

    it('caps a split sale’s cash at the server total', () => {
        const payment: PaymentInfo = {
            method: 'SPLIT',
            split: {
                cashAmount: 100000,
                onlineAmount: 0,
                cashTendered: 100000,
                cashChange: 0,
                referenceNumber: 'r',
                onlineMethod: 'GCash QR',
            },
        };

        expect(drawerCashAmount(payment, receipt)).toBe(80000);
    });

    it('puts no cash in the drawer for GCash', () => {
        expect(
            drawerCashAmount(
                { method: 'GCASH', referenceNumber: 'r' },
                receipt,
            ),
        ).toBe(0);
    });
});
