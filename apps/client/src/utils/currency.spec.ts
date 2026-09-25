import { describe, expect, it } from 'vitest';
import {
    parsePesos,
    centavosToPesoInput,
    formatCurrency,
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
    it('converts typed pesos to whole centavos from the decimal digits', () => {
        expect(pesosToCentavos('19.99')).toBe(1999);
        expect(pesosToCentavos('19.9')).toBe(1990);
        expect(pesosToCentavos('20')).toBe(2000);
        expect(pesosToCentavos('20.')).toBe(2000);
        expect(pesosToCentavos('.25')).toBe(25);
        expect(pesosToCentavos('-5.00')).toBe(-500);
        // 1.15 * 100 is 114.99999999999999 as a double.
        expect(pesosToCentavos('1.15')).toBe(115);
    });

    it('accepts numbers, as v-model.number delivers them', () => {
        expect(pesosToCentavos(0.25)).toBe(25);
        expect(pesosToCentavos(110.41)).toBe(11041);
    });

    it('treats more than two decimals as invalid, not silently rounded', () => {
        // Float rounding sent 0.005 to 1 but 1.005 to 100.
        expect(pesosToCentavos('0.005')).toBe(0);
        expect(pesosToCentavos('1.005')).toBe(0);
        expect(pesosToCentavos(1.005)).toBe(0);
    });

    it('treats blank or invalid input as zero', () => {
        expect(pesosToCentavos('')).toBe(0);
        expect(pesosToCentavos('.')).toBe(0);
        expect(pesosToCentavos('abc')).toBe(0);
        expect(pesosToCentavos('1e3')).toBe(0);
        expect(pesosToCentavos(null)).toBe(0);
    });

    it('round-trips the pre-filled input value', () => {
        expect(centavosToPesoInput(11041)).toBe('110.41');
        expect(pesosToCentavos(centavosToPesoInput(11041))).toBe(11041);
    });
});

describe('parsePesos (#17)', () => {
    it('tells blank and mistyped input apart from a real zero', () => {
        expect(parsePesos('0')).toBe(0);
        expect(parsePesos('0.00')).toBe(0);
        expect(parsePesos('')).toBeNull();
        expect(parsePesos('   ')).toBeNull();
        expect(parsePesos(null)).toBeNull();
        expect(parsePesos(undefined)).toBeNull();
        expect(parsePesos('.')).toBeNull();
        expect(parsePesos('-')).toBeNull();
        expect(parsePesos('abc')).toBeNull();
        expect(parsePesos('1e3')).toBeNull();
        expect(parsePesos('1.005')).toBeNull();
        expect(parsePesos('1,000')).toBeNull();
    });

    it('parses whole, decimal and negative amounts exactly', () => {
        expect(parsePesos('12')).toBe(1200);
        expect(parsePesos(' 12.5 ')).toBe(1250);
        expect(parsePesos('.05')).toBe(5);
        expect(parsePesos('-3.10')).toBe(-310);
        expect(parsePesos(19.99)).toBe(1999);
    });
});
