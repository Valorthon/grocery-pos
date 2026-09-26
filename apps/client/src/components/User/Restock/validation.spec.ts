import { describe, expect, it } from 'vitest';
import type { AddFormInput } from './dto';
import { restockLineErrors, restockSaveErrors } from './validation';

const EXISTING: AddFormInput = {
    isNewProduct: false,
    autoGenerateEAN: false,
    EAN: '4800361002516',
    name: 'BEAR BRAND MILK',
    product: '64b000000000000000000001',
    quantity: 6,
    unitCost: '12.50',
    price: '',
};

const NEW: AddFormInput = {
    ...EXISTING,
    isNewProduct: true,
    product: '',
    EAN: '',
    autoGenerateEAN: true,
    name: 'Coffee',
    price: '9.75',
};

describe('restockLineErrors (#17)', () => {
    it('accepts a picked product and a complete new product', () => {
        expect(restockLineErrors(EXISTING)).toEqual({});
        expect(restockLineErrors(NEW)).toEqual({});
        expect(
            restockLineErrors({
                ...NEW,
                autoGenerateEAN: false,
                EAN: '4006381333931',
            }),
        ).toEqual({});
    });

    it('needs a picked product id, not the typed search text', () => {
        expect(
            restockLineErrors({ ...EXISTING, EAN: 'bear', product: '' }),
        ).toEqual({ EAN: 'Pick a product from the matches' });
    });

    it('rejects a blank or negative unit cost, as the API does', () => {
        expect(restockLineErrors({ ...EXISTING, unitCost: '' }).unitCost).toBe(
            'This field is required',
        );
        expect(
            restockLineErrors({ ...EXISTING, unitCost: '-1' }).unitCost,
        ).toBe('Enter at least ₱0.00');
        expect(
            restockLineErrors({ ...EXISTING, unitCost: '-0.01' }).unitCost,
        ).toBe('Enter at least ₱0.00');
    });

    it('accepts a ₱0 unit cost (confirmed on save, #85)', () => {
        expect(restockLineErrors({ ...EXISTING, unitCost: '0' })).toEqual({});
        expect(restockLineErrors({ ...EXISTING, unitCost: '0.00' })).toEqual(
            {},
        );
    });

    it('rejects a blank, zero or fractional quantity', () => {
        expect(restockLineErrors({ ...EXISTING, quantity: '' }).quantity).toBe(
            'This field is required',
        );
        expect(restockLineErrors({ ...EXISTING, quantity: 0 }).quantity).toBe(
            'Must be at least 1',
        );
        expect(restockLineErrors({ ...EXISTING, quantity: 1.5 }).quantity).toBe(
            'Enter a whole number',
        );
    });

    it('checks a new product name, price and barcode', () => {
        expect(restockLineErrors({ ...NEW, price: '' }).price).toBe(
            'This field is required',
        );
        expect(restockLineErrors({ ...NEW, name: '' }).name).toBeTruthy();
        expect(
            restockLineErrors({ ...NEW, autoGenerateEAN: false, EAN: '' }).EAN,
        ).toBe('This field is required');
    });

    it('ignores the new-product fields on an existing-product line', () => {
        expect(restockLineErrors({ ...EXISTING, name: '', price: '' })).toEqual(
            {},
        );
    });
});

describe('restockSaveErrors (#17)', () => {
    it('requires a description within the contracts limit', () => {
        expect(restockSaveErrors({ description: 'Delivery' })).toEqual({});
        expect(restockSaveErrors({ description: '  ' }).description).toBe(
            'This field is required',
        );
        expect(
            restockSaveErrors({ description: 'x'.repeat(301) }).description,
        ).toBe('At most 300 characters');
    });
});
