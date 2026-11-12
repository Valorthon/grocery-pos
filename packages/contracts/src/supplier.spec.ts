import { describe, expect, it } from 'vitest';
import { marginBasisPoints } from './supplier.js';

describe('marginBasisPoints', () => {
    it('truncates toward zero like integer division', () => {
        expect(marginBasisPoints(15000, 6000)).toBe(6000);
        expect(marginBasisPoints(3000, 2000)).toBe(3333);
        expect(marginBasisPoints(11429, 3641)).toBe(6814);
        expect(marginBasisPoints(3000, 4000)).toBe(-3333);
        expect(marginBasisPoints(100, 0)).toBe(10000);
    });
    it('is undefined without a usable price or cost', () => {
        expect(marginBasisPoints(100, undefined)).toBeUndefined();
        expect(marginBasisPoints(0, 10)).toBeUndefined();
        expect(marginBasisPoints(1.5, 1)).toBeUndefined();
    });
});
