import { describe, expect, it } from 'vitest';
import {
    BARCODE_MESSAGES,
    NUMERIC_LIMITS,
    STRING_LIMITS,
} from '@grocery-pos/contracts';
import {
    barcodeFieldError,
    confirmPasswordError,
    currentPasswordError,
    DATE_RANGE_REVERSED,
    dateRangeError,
    fieldErrors,
    integerError,
    moneyError,
    PASSWORD_HINT,
    passwordError,
    PASSWORDS_DIFFER,
    productPickError,
    REQUIRED,
    textError,
} from './rules';

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

describe('change-password fields (ChangePasswordDto, #88)', () => {
    it('requires the current password, with no minimum and no trim', () => {
        expect(currentPasswordError('')).not.toBe('');
        // @IsNotEmpty only refuses '': an old short password still counts.
        expect(currentPasswordError('a')).toBe('');
        expect(currentPasswordError('   ')).toBe('');
        expect(currentPasswordError('x'.repeat(STRING_LIMITS.PASSWORD))).toBe(
            '',
        );
        expect(
            currentPasswordError('x'.repeat(STRING_LIMITS.PASSWORD + 1)),
        ).not.toBe('');
    });

    it('applies the password policy to the new password', () => {
        const min = STRING_LIMITS.PASSWORD_MIN;
        expect(passwordError('x'.repeat(min - 1))).toBe(PASSWORD_HINT);
        // Not trimmed: spaces count, as on the API.
        expect(passwordError(' '.repeat(min))).toBe('');
    });

    it('needs the confirmation to repeat the new password exactly', () => {
        expect(confirmPasswordError('new-secret', '')).not.toBe('');
        expect(confirmPasswordError('new-secret', 'new-secret')).toBe('');
        expect(confirmPasswordError('new-secret', 'new-secret ')).toBe(
            PASSWORDS_DIFFER,
        );
        expect(confirmPasswordError('new-secret', 'New-secret')).toBe(
            PASSWORDS_DIFFER,
        );
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

describe('textError (#17)', () => {
    it('requires text after trimming, as the API trims it', () => {
        expect(textError('', 10)).toBe(REQUIRED);
        expect(textError('   ', 10)).toBe(REQUIRED);
        expect(textError(undefined, 10)).toBe(REQUIRED);
        expect(textError(' ok ', 10)).toBe('');
    });

    it('caps the trimmed length at the contracts limit', () => {
        const max = STRING_LIMITS.REASON;
        expect(textError('x'.repeat(max), max)).toBe('');
        expect(textError(`  ${'x'.repeat(max)}  `, max)).toBe('');
        expect(textError('x'.repeat(max + 1), max)).toBe(
            `At most ${max} characters`,
        );
    });
});

describe('integerError (#17)', () => {
    it('rejects a blank v-model.number field', () => {
        // looseToNumber('') is '', which `== null || < 1` used to let through.
        expect(integerError('')).toBe(REQUIRED);
        expect(integerError('  ')).toBe(REQUIRED);
        expect(integerError(null)).toBe(REQUIRED);
        expect(integerError(undefined)).toBe(REQUIRED);
    });

    it('rejects fractions, NaN and unparsed text', () => {
        expect(integerError(1.5)).toBe('Enter a whole number');
        expect(integerError(Number.NaN)).toBe('Enter a whole number');
        expect(integerError(Infinity)).toBe('Enter a whole number');
        expect(integerError('abc')).toBe('Enter a whole number');
    });

    it('applies a minimum, e.g. a restock quantity', () => {
        const min = NUMERIC_LIMITS.QUANTITY_MIN;
        expect(integerError(0, { min })).toBe(`Must be at least ${min}`);
        expect(integerError(-3, { min })).toBe(`Must be at least ${min}`);
        expect(integerError(1, { min })).toBe('');
    });

    it('allows a negative but not a zero adjustment change', () => {
        expect(integerError(0, { nonZero: true })).toBe('Must not be 0');
        expect(integerError(-2, { nonZero: true })).toBe('');
        expect(integerError(7, { nonZero: true })).toBe('');
    });
});

describe('moneyError (#17)', () => {
    it('rejects a blank amount instead of recording ₱0', () => {
        expect(moneyError('')).toBe(REQUIRED);
        expect(moneyError(' ')).toBe(REQUIRED);
        expect(moneyError(null)).toBe(REQUIRED);
    });

    it('rejects text that is not pesos with up to 2 decimals', () => {
        const message = 'Enter an amount in pesos, up to 2 decimals';
        expect(moneyError('abc')).toBe(message);
        expect(moneyError('1.005')).toBe(message);
        expect(moneyError('1e3')).toBe(message);
        expect(moneyError('1,000')).toBe(message);
        expect(moneyError({})).toBe(message);
    });

    it('matches the API bounds: at least one centavo, at most AMOUNT_MAX', () => {
        expect(moneyError('0')).toBe('Enter at least ₱0.01');
        expect(moneyError('-5')).toBe('Enter at least ₱0.01');
        expect(moneyError('0.01')).toBe('');
        expect(moneyError('10000000')).toBe('');
        expect(NUMERIC_LIMITS.AMOUNT_MAX).toBe(1_000_000_000);
        expect(moneyError('10000000.01')).toBe('At most ₱10,000,000.00');
    });

    it('accepts a number as well as text', () => {
        expect(moneyError(12.5)).toBe('');
    });
});

describe('productPickError (#17)', () => {
    it('needs a picked product id, not typed text', () => {
        expect(productPickError('')).not.toBe('');
        expect(productPickError(undefined)).not.toBe('');
        expect(productPickError('64b000000000000000000001')).toBe('');
    });
});

describe('fieldErrors', () => {
    it('keeps only the refused fields', () => {
        expect(fieldErrors({ a: '', b: 'bad' })).toEqual({ b: 'bad' });
        expect(fieldErrors({ a: '' })).toEqual({});
    });
});

describe('dateRangeError (the API dateTo rule, #20)', () => {
    it('refuses an end before the start', () => {
        expect(dateRangeError('2026-03-02', '2026-03-01')).toBe(
            DATE_RANGE_REVERSED,
        );
        expect(dateRangeError('2026-01-01', '2025-12-31')).toBe(
            DATE_RANGE_REVERSED,
        );
    });

    it('accepts a one-day or forward range, or an open end', () => {
        expect(dateRangeError('2026-03-01', '2026-03-01')).toBe('');
        expect(dateRangeError('2026-02-28', '2026-03-01')).toBe('');
        expect(dateRangeError('2026-03-01', '')).toBe('');
        expect(dateRangeError('', '2026-03-01')).toBe('');
        expect(dateRangeError('', '')).toBe('');
    });
});
