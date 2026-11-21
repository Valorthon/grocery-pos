import { describe, expect, it } from 'vitest';
import {
    DiscountType,
    PaymentType,
    SaleStatus,
    TenderType,
    UnitOfMeasure,
} from '@grocery-pos/contracts';
import {
    discountLabel,
    hasCashTender,
    saleNumber,
    saleSummaryReceipt,
} from './receipt';
import type { Receipt } from '@grocery-pos/contracts';

describe('discountLabel (#218, shared with Sale Details)', () => {
    it('names a percent discount by its percent, a fixed one as Fixed', () => {
        const base = { reason: 'r', amount: 100 };
        expect(
            discountLabel({ ...base, type: DiscountType.PERCENT, value: 10 }),
        ).toBe('10%');
        expect(
            discountLabel({ ...base, type: DiscountType.FIXED, value: 100 }),
        ).toBe('Fixed');
    });
});

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

describe('saleSummaryReceipt (#417)', () => {
    it('builds the summary from the stored sale and its lines', () => {
        const receipt = saleSummaryReceipt({
            id: 'sale1',
            cashierName: 'ana',
            occurredAt: '2026-09-24T01:00:00.000Z',
            status: SaleStatus.COMPLETED,
            paymentType: PaymentType.SPLIT,
            referenceNumber: '1234567890123',
            tenders: [
                { type: TenderType.CASH, amount: 5_000 },
                { type: TenderType.GCASH, amount: 3_000 },
            ],
            changeGiven: 0,
            amount: 8_000,
            discount: {
                type: DiscountType.FIXED,
                value: 1_000,
                reason: 'promo',
                amount: 1_000,
                approvedBy: 'admin1',
            } as never,
            lines: [
                {
                    _id: 'l1',
                    sales: 'sale1',
                    product: { _id: 'p1', name: 'Rice' },
                    quantity: 450,
                    unit: UnitOfMeasure.KG,
                    unitPrice: 18_000,
                },
                {
                    _id: 'l2',
                    sales: 'sale1',
                    product: null,
                    quantity: 1,
                    unitPrice: 900,
                },
            ],
        });
        expect(receipt.items).toEqual([
            {
                productName: 'Rice',
                quantity: 450,
                amount: 8_100,
                unit: UnitOfMeasure.KG,
                unitPrice: 18_000,
            },
            { productName: 'N/A', quantity: 1, amount: 900 },
        ]);
        expect(receipt.subtotal).toBe(9_000);
        expect(receipt.totalAmount).toBe(8_000);
        expect(receipt.amountTendered).toBe(8_000);
        expect(receipt.discount).toEqual({
            type: DiscountType.FIXED,
            value: 1_000,
            reason: 'promo',
            amount: 1_000,
        });
        expect(receipt.createdAt).toBe('2026-09-24T01:00:00.000Z');
        expect('storeIdentity' in receipt).toBe(false);
    });
});
