import { describe, expect, it } from 'vitest';
import { BARCODE_MESSAGES, STRING_LIMITS } from '@grocery-pos/contracts';
import { barcodeFieldError, PASSWORD_HINT, passwordError } from './rules';

describe('passwordError (the API password policy, #12)', () => {
    const min = STRING_LIMITS.PASSWORD_MIN;

    it('shows the minimum length', () => {
        expect(PASSWORD_HINT).toBe(`At least ${min} characters`);
    });

    it('rejects a password shorter than the minimum', () => {
        expect(passwordError('x'.repeat(min - 1))).toBe(PASSWORD_HINT);
        expect(passwordError('x'.repeat(min))).toBe('');
    });

    it('rejects one longer than the maximum', () => {
        expect(passwordError('x'.repeat(STRING_LIMITS.PASSWORD + 1))).not.toBe(
            '',
        );
    });

    it('requires a value unless optional', () => {
        expect(passwordError('')).not.toBe('');
        expect(passwordError('', true)).toBe('');
        expect(passwordError('short', true)).toBe(PASSWORD_HINT);
    });
});

describe('barcodeFieldError (the API barcode rules, #14)', () => {
    it('accepts EAN-13, UPC-A and EAN-8 with a valid check digit', () => {
        expect(barcodeFieldError('4006381333931', false)).toBe('');
        expect(barcodeFieldError(' 036000291452 ', false)).toBe('');
        expect(barcodeFieldError('96385074', false)).toBe('');
    });

    it('explains which rule a code breaks', () => {
        expect(barcodeFieldError('abc', false)).toBe(BARCODE_MESSAGES.FORMAT);
        expect(barcodeFieldError('4006381333932', false)).toBe(
            BARCODE_MESSAGES.CHECK_DIGIT,
        );
        expect(barcodeFieldError('2000000000015', false)).toBe(
            BARCODE_MESSAGES.RESERVED,
        );
    });

    it('requires a code unless it is auto-generated', () => {
        expect(barcodeFieldError('', false)).toBe('This field is required');
        expect(barcodeFieldError('', true)).toBe('');
        expect(barcodeFieldError('abc', true)).toBe('');
    });
});
