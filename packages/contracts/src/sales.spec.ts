import { describe, expect, it } from 'vitest';
import {
    REVERSAL_STATUS,
    ReversalType,
    SaleStatus,
    isValidReferenceNumber,
    normalizeReferenceNumber,
} from './sales';

describe('GCash reference numbers', () => {
    it('strips the spaces GCash prints between digit groups', () => {
        expect(normalizeReferenceNumber('1234 567 890123')).toBe(
            '1234567890123',
        );
        expect(normalizeReferenceNumber(' 12\t34 ')).toBe('1234');
    });

    it('accepts exactly 13 digits', () => {
        expect(isValidReferenceNumber('1234567890123')).toBe(true);
        expect(isValidReferenceNumber('123456789012')).toBe(false);
        expect(isValidReferenceNumber('12345678901234')).toBe(false);
        expect(isValidReferenceNumber('123456789012a')).toBe(false);
        expect(isValidReferenceNumber('1234 56789012')).toBe(false);
    });
});

describe('REVERSAL_STATUS', () => {
    it('maps a void to VOIDED and a refund to REFUNDED', () => {
        expect(REVERSAL_STATUS[ReversalType.VOID]).toBe(SaleStatus.VOIDED);
        expect(REVERSAL_STATUS[ReversalType.REFUND]).toBe(SaleStatus.REFUNDED);
    });
});
