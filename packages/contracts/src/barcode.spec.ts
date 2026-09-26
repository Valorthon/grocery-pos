import { describe, expect, it } from 'vitest';
import {
    BARCODE_MESSAGES,
    GENERATED_BARCODE_PREFIX,
    barcodeError,
    gtinCheckDigit,
    hasValidCheckDigit,
    isCompleteBarcode,
    isReservedBarcode,
} from './barcode.js';

const EAN_13 = '4006381333931';
const UPC_A = '036000291452';
const EAN_8 = '96385074';

describe('gtinCheckDigit', () => {
    it('computes the GS1 check digit for each length', () => {
        expect(gtinCheckDigit(EAN_13.slice(0, -1))).toBe(1);
        expect(gtinCheckDigit(UPC_A.slice(0, -1))).toBe(2);
        expect(gtinCheckDigit(EAN_8.slice(0, -1))).toBe(4);
    });

    it('gives 0 when the weighted sum is a multiple of 10', () => {
        expect(gtinCheckDigit('0000000')).toBe(0);
    });
});

describe('hasValidCheckDigit', () => {
    it('accepts valid codes and rejects a wrong last digit', () => {
        expect(hasValidCheckDigit(EAN_13)).toBe(true);
        expect(hasValidCheckDigit(UPC_A)).toBe(true);
        expect(hasValidCheckDigit(EAN_8)).toBe(true);
        expect(hasValidCheckDigit('4006381333932')).toBe(false);
    });

    it('rejects non-digits and codes too short to carry a check digit', () => {
        expect(hasValidCheckDigit('40063813339a1')).toBe(false);
        expect(hasValidCheckDigit('5')).toBe(false);
        expect(hasValidCheckDigit('')).toBe(false);
    });
});

describe('isReservedBarcode', () => {
    it('is true only for 13-digit codes in the generated range', () => {
        expect(GENERATED_BARCODE_PREFIX).toBe('200');
        expect(isReservedBarcode('2000000000015')).toBe(true);
        expect(isReservedBarcode(EAN_13)).toBe(false);
        // A UPC-A that happens to start with 200 is not in the range.
        expect(isReservedBarcode('200000000015')).toBe(false);
    });
});

describe('isCompleteBarcode (issue #87)', () => {
    it('accepts EAN-13, UPC-A and EAN-8 with valid check digits', () => {
        expect(isCompleteBarcode(EAN_13)).toBe(true);
        expect(isCompleteBarcode(UPC_A)).toBe(true);
        expect(isCompleteBarcode(EAN_8)).toBe(true);
    });

    it('accepts a generated code in the reserved range', () => {
        expect(isCompleteBarcode('2000000000015')).toBe(true);
    });

    it('rejects a wrong check digit at every length', () => {
        expect(isCompleteBarcode('4006381333932')).toBe(false);
        expect(isCompleteBarcode('036000291453')).toBe(false);
        expect(isCompleteBarcode('96385075')).toBe(false);
    });

    it('rejects other lengths and non-digits', () => {
        // Valid GS1 check digits, but not a barcode length.
        expect(isCompleteBarcode('1234565')).toBe(false);
        expect(isCompleteBarcode('00000000000000')).toBe(false);
        expect(isCompleteBarcode('9638507a')).toBe(false);
        expect(isCompleteBarcode('')).toBe(false);
        expect(isCompleteBarcode('milk')).toBe(false);
    });
});

describe('barcodeError', () => {
    it('accepts EAN-13, UPC-A and EAN-8 with valid check digits', () => {
        expect(barcodeError(EAN_13)).toBeNull();
        expect(barcodeError(UPC_A)).toBeNull();
        expect(barcodeError(EAN_8)).toBeNull();
    });

    it('refuses other lengths and non-digits as a format error', () => {
        expect(barcodeError('1234567')).toBe(BARCODE_MESSAGES.FORMAT);
        expect(barcodeError('12345678901')).toBe(BARCODE_MESSAGES.FORMAT);
        expect(barcodeError(' 96385074')).toBe(BARCODE_MESSAGES.FORMAT);
        expect(barcodeError('9638507A')).toBe(BARCODE_MESSAGES.FORMAT);
    });

    it('refuses a bad check digit before the reserved range', () => {
        expect(barcodeError('96385075')).toBe(BARCODE_MESSAGES.CHECK_DIGIT);
        // Reserved and with a bad check digit: the check digit wins.
        expect(barcodeError('2000000000016')).toBe(
            BARCODE_MESSAGES.CHECK_DIGIT,
        );
    });

    it('refuses a valid code in the generated range', () => {
        const body = '200000000123';
        const code = body + String(gtinCheckDigit(body));
        expect(barcodeError(code)).toBe(BARCODE_MESSAGES.RESERVED);
    });
});
