import { describe, expect, it } from 'vitest';
import {
    PurchaseOrderStatus,
    UnitOfMeasure,
    type PurchaseOrderView,
} from '@grocery-pos/contracts';
import {
    costVariance,
    draftLineErrors,
    draftLinesOf,
    draftTotal,
    newReceiveKey,
    receiptErrors,
    receiptForm,
    toPurchaseOrderBody,
    toReceiveBody,
} from './purchase-order';

function po(): PurchaseOrderView {
    return {
        _id: 'po',
        supplier: { _id: 's', name: 'Farm', isActive: true },
        status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
        version: 3,
        createdBy: null,
        closedShort: false,
        receipts: [],
        expectedTotal: 0,
        createdAt: '2026-11-06T00:00:00.000Z',
        updatedAt: '2026-11-06T00:00:00.000Z',
        lines: [
            {
                _id: 'l1',
                product: 'p1',
                name: 'rice',
                EAN: '4800000000017',
                unit: UnitOfMeasure.KG,
                tracksExpiry: true,
                productActive: true,
                orderedQty: 5000,
                receivedQty: 4550,
                outstandingQty: 450,
                expectedCost: 18000,
            },
            {
                _id: 'l2',
                product: 'p2',
                name: 'soap',
                EAN: '4800000000024',
                unit: UnitOfMeasure.PIECE,
                tracksExpiry: false,
                productActive: true,
                orderedQty: 2,
                receivedQty: 2,
                outstandingQty: 0,
                expectedCost: 100,
            },
        ],
    };
}

describe('purchase order drafts', () => {
    it('maps typed display units and pesos to minor units and centavos', () => {
        const lines = draftLinesOf(po());
        expect(lines[0]).toMatchObject({ quantity: '5.000', cost: '180.00' });
        lines[0]!.quantity = '0.45';
        expect(draftTotal(lines)).toBe(8100 + 200);
        expect(toPurchaseOrderBody('s', '  ', lines)).toEqual({
            supplier: 's',
            lines: [
                { product: 'p1', orderedQty: 450, expectedCost: 18000 },
                { product: 'p2', orderedQty: 2, expectedCost: 100 },
            ],
        });
        expect(toPurchaseOrderBody('s', ' note ', lines).note).toBe('note');
    });
    it('flags invalid quantities and costs per line, allowing ₱0', () => {
        const lines = draftLinesOf(po());
        lines[0]!.quantity = '0.0001';
        lines[1]!.cost = '0';
        expect(Object.keys(draftLineErrors(lines))).toEqual(['0']);
        lines[1]!.cost = '-1';
        expect(draftLineErrors(lines)[1]).toHaveProperty('cost');
    });
});

describe('purchase order receipts', () => {
    it('prefills only outstanding lines at the expected cost and shows variance', () => {
        const form = receiptForm(po());
        expect(form).toHaveLength(1);
        expect(form[0]).toMatchObject({ quantity: '0.450', cost: '180.00' });
        form[0]!.cost = '175.50';
        expect(costVariance(form[0]!)).toBe(-450);
        form[0]!.cost = 'x';
        expect(costVariance(form[0]!)).toBeNull();
    });
    it('refuses over-receipt and a tracked line without expiry', () => {
        const form = receiptForm(po());
        form[0]!.quantity = '0.451';
        const errors = receiptErrors(form)[0]!;
        expect(errors.quantity).toContain('outstanding');
        expect(errors.expiryDate).toBeTruthy();
        form[0]!.quantity = '';
        expect(receiptErrors(form)).toEqual({});
    });
    it('sends received lines only, with expiry and trimmed batch', () => {
        const form = receiptForm(po());
        form[0]!.expiryDate = '2099-01-31';
        form[0]!.batchNo = ' B7 ';
        expect(toReceiveBody(po(), 'key', form, ' DR-1 ', '')).toEqual({
            version: 3,
            idempotencyKey: 'key',
            invoiceNumber: 'DR-1',
            lines: [
                {
                    line: 'l1',
                    quantity: 450,
                    unitCost: 18000,
                    expiryDate: '2099-01-31',
                    batchNo: 'B7',
                },
            ],
        });
        form[0]!.quantity = '0';
        expect(toReceiveBody(po(), 'key', form, '', 'x').lines).toEqual([]);
    });
    it('makes server-acceptable unique keys', () => {
        const a = newReceiveKey();
        expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
        expect(newReceiveKey()).not.toBe(a);
    });
});
