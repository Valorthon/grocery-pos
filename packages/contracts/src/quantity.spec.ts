import { describe, expect, it } from 'vitest';
import { UnitOfMeasure as U } from './enums.js';
import {
    formatQuantity,
    maxQuantityForAmount,
    parseQuantity,
    quantityAmount,
    quantityDecimals,
    quantityInput,
    quantityScale,
    reorderLevelOf,
    reorderQuantityOf,
    unitLabel,
    unitOf,
} from './quantity.js';

describe('fixed-precision measured quantities', () => {
    it('preserves legacy piece quantities and names every supported unit', () => {
        expect(unitOf()).toBe(U.PIECE);
        for (const unit of Object.values(U)) {
            expect(unitOf(unit)).toBe(unit);
            expect(unitLabel(unit)).toBe(
                { PIECE: 'pc', KG: 'kg', G: 'g', L: 'L' }[unit],
            );
            expect(quantityScale(unit)).toBe(
                [U.KG, U.L].includes(unit) ? 1000 : 1,
            );
            expect(quantityDecimals(unit)).toBe(
                [U.KG, U.L].includes(unit) ? 3 : 0,
            );
        }
        expect(unitLabel()).toBe('pc');
    });
    it.each([
        ['0.450', U.KG, 450],
        ['1', U.KG, 1000],
        ['1.1', U.L, 1100],
        ['1.23', U.L, 1230],
        ['-0.005', U.KG, -5],
        ['450', U.G, 450],
        ['2', U.PIECE, 2],
        [' 3 ', undefined, 3],
        ['0', U.PIECE, 0],
        [2, U.KG, 2000],
    ])('parses %s in %s to exact minor units', (text, unit, expected) => {
        expect(parseQuantity(text, unit)).toBe(expected);
    });
    it.each([
        '',
        ' ',
        '.45',
        '1e3',
        '1,5',
        'NaN',
        'Infinity',
        '--1',
        '0.0001',
        '9007199254740992',
        '-9007199254740992',
    ])('refuses malformed or excessive precision/bounds: %s', (text) => {
        expect(parseQuantity(text, U.KG)).toBeNull();
    });
    it('piece and gram input forbid fractional amounts; exact safe limits survive round trips', () => {
        expect(parseQuantity('1.1', U.PIECE)).toBeNull();
        expect(parseQuantity('1.0', U.G)).toBeNull();
        expect(parseQuantity(String(Number.MAX_SAFE_INTEGER))).toBe(
            Number.MAX_SAFE_INTEGER,
        );
        expect(parseQuantity(String(Number.MIN_SAFE_INTEGER))).toBe(
            Number.MIN_SAFE_INTEGER,
        );
        expect(quantityInput(-450, U.KG)).toBe('-0.450');
        expect(quantityInput(1200, U.L)).toBe('1.200');
        expect(quantityInput(5)).toBe('5');
        expect(formatQuantity(450, U.KG)).toBe('0.450 kg');
    });
    it('prices 0.450 kg at ₱180/kg as ₱81, and rounds a half cent up', () => {
        expect(quantityAmount(18_000, 450, U.KG)).toBe(8100);
        expect(quantityAmount(1, 499, U.KG)).toBe(0);
        expect(quantityAmount(1, 500, U.KG)).toBe(1);
        expect(quantityAmount(100, 2)).toBe(200);
        expect(quantityAmount(0, Number.MAX_SAFE_INTEGER, U.L)).toBe(0);
        expect(quantityAmount(100, 1000, U.L)).toBe(100);
    });
    it('does not accumulate drift over 1000 weighed sales', () => {
        let stock = 450_000;
        let total = 0;
        for (let n = 0; n < 1000; n++) {
            stock -= parseQuantity('0.450', U.KG)!;
            total += quantityAmount(18_000, 450, U.KG);
        }
        expect(stock).toBe(0);
        expect(total).toBe(8_100_000);
    });
    it.each([
        [1.5, 1],
        [1, 0.1],
        [-1, 1],
        [1, -1],
        [Infinity, 1],
        [Number.MAX_SAFE_INTEGER, 2],
    ])('rejects unsafe line arithmetic (%s, %s)', (price, quantity) => {
        expect(() => quantityAmount(price, quantity)).toThrow(RangeError);
    });
    it('computes the largest minor quantity which rounds within the amount cap', () => {
        expect(maxQuantityForAmount(100, 10)).toBe(10);
        const max = maxQuantityForAmount(100, 3, U.KG);
        expect(quantityAmount(3, max, U.KG)).toBeLessThanOrEqual(100);
        expect(quantityAmount(3, max + 1, U.KG)).toBeGreaterThan(100);
        expect(maxQuantityForAmount(-10, 2)).toBe(0);
        expect(maxQuantityForAmount(10, 0)).toBe(10);
        expect(maxQuantityForAmount(Number.MAX_SAFE_INTEGER, 1, U.KG)).toBe(
            Number.MAX_SAFE_INTEGER,
        );
    });
});

describe('per-product reorder defaults', () => {
    it('keeps ten displayed units for legacy records and every measure', () => {
        expect(reorderLevelOf({})).toBe(10);
        expect(reorderQuantityOf({})).toBe(10);
        for (const unit of Object.values(U)) {
            expect(reorderLevelOf({ unit })).toBe(10 * quantityScale(unit));
            expect(reorderQuantityOf({ unit })).toBe(10 * quantityScale(unit));
        }
    });
    it('retains explicit zero levels and exact measured quantities', () => {
        expect(reorderLevelOf({ unit: U.KG, reorderLevel: 0 })).toBe(0);
        expect(reorderQuantityOf({ unit: U.KG, reorderQuantity: 450 })).toBe(
            450,
        );
    });
});
