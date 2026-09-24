import { describe, expect, it } from 'vitest';
import {
    centavosToPesoInput,
    formatCurrency,
    percentOf,
    pesosToCentavos,
} from './currency';

describe('formatCurrency', () => {
    it('formats centavos as pesos with exactly two decimals', () => {
        expect(formatCurrency(123450)).toBe('₱1,234.50');
        expect(formatCurrency(500)).toBe('₱5.00');
        expect(formatCurrency(1)).toBe('₱0.01');
        expect(formatCurrency(0)).toBe('₱0.00');
    });

    it('puts the minus sign before the peso sign', () => {
        expect(formatCurrency(-500)).toBe('-₱5.00');
        expect(formatCurrency(-123450)).toBe('-₱1,234.50');
    });
});

describe('pesosToCentavos', () => {
    it('converts typed pesos to whole centavos', () => {
        expect(pesosToCentavos('19.99')).toBe(1999);
        // 1.15 * 100 is 114.99999999999999 as a double; it must round, not truncate.
        expect(pesosToCentavos('1.15')).toBe(115);
        expect(pesosToCentavos(0.25)).toBe(25);
    });

    it('treats blank or invalid input as zero', () => {
        expect(pesosToCentavos('')).toBe(0);
        expect(pesosToCentavos('abc')).toBe(0);
        expect(pesosToCentavos(null)).toBe(0);
    });

    it('round-trips the pre-filled input value', () => {
        expect(pesosToCentavos(centavosToPesoInput(11041))).toBe(11041);
        expect(centavosToPesoInput(11041)).toBe('110.41');
    });
});

describe('percentOf', () => {
    it('rounds to a whole centavo', () => {
        // 15% off ₱129.90 is ₱19.485 of discount.
        expect(percentOf(12990, 15)).toBe(1949);
    });

    it('lets a customer tender exactly the displayed total', () => {
        // Regression: the cash branch compared against the unrounded 110.415,
        // so tendering the ₱110.41 on screen left Confirm disabled.
        const total = 12990 - percentOf(12990, 15);

        expect(formatCurrency(total)).toBe('₱110.41');
        expect(pesosToCentavos('110.41') >= total).toBe(true);
    });
});
