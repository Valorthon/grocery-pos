import { describe, expect, it } from 'vitest';
import { countOf } from './plural';

describe('countOf', () => {
    it('uses the singular for exactly one', () => {
        expect(countOf(1, 'line')).toBe('1 line');
    });

    it('uses the plural otherwise, zero included', () => {
        expect(countOf(0, 'item')).toBe('0 items');
        expect(countOf(5, 'item')).toBe('5 items');
    });

    it('takes an irregular plural', () => {
        expect(countOf(2, 'box', 'boxes')).toBe('2 boxes');
    });
});
