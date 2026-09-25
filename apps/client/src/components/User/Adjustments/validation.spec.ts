import { describe, expect, it } from 'vitest';
import type { AddFormInput } from './dto';
import { adjustmentLineErrors, adjustmentSaveErrors } from './validation';

const LINE: AddFormInput = {
    EAN: '4800361002516',
    name: 'BEAR BRAND MILK',
    product: '64b000000000000000000001',
    change: -2,
    reason: 'expired',
};

describe('adjustmentLineErrors (#17)', () => {
    it('accepts a picked product with a negative or positive change', () => {
        expect(adjustmentLineErrors(LINE)).toEqual({});
        expect(adjustmentLineErrors({ ...LINE, change: 5 })).toEqual({});
    });

    it('needs a picked product id, not the typed search text', () => {
        expect(
            adjustmentLineErrors({ ...LINE, EAN: 'bear', product: '' }),
        ).toEqual({ EAN: 'Pick a product from the matches' });
    });

    it('rejects a blank, zero or fractional change', () => {
        expect(adjustmentLineErrors({ ...LINE, change: '' }).change).toBe(
            'This field is required',
        );
        expect(adjustmentLineErrors({ ...LINE, change: 0 }).change).toBe(
            'Must not be 0',
        );
        expect(adjustmentLineErrors({ ...LINE, change: 0.5 }).change).toBe(
            'Enter a whole number',
        );
    });

    it('requires a reason within the contracts limit', () => {
        expect(adjustmentLineErrors({ ...LINE, reason: ' ' }).reason).toBe(
            'This field is required',
        );
        expect(
            adjustmentLineErrors({ ...LINE, reason: 'x'.repeat(101) }).reason,
        ).toBe('At most 100 characters');
    });
});

describe('adjustmentSaveErrors (#17)', () => {
    it('requires a description within the contracts limit', () => {
        expect(adjustmentSaveErrors({ description: 'Count' })).toEqual({});
        expect(adjustmentSaveErrors({ description: '' }).description).toBe(
            'This field is required',
        );
        expect(
            adjustmentSaveErrors({ description: 'x'.repeat(301) }).description,
        ).toBe('At most 300 characters');
    });
});
