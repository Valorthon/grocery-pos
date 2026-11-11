import { describe, expect, it } from 'vitest';
import { productSearchParams } from './product-search';

describe('productSearchParams (#260)', () => {
    it('sends a short or full digits-only term as an EAN prefix', () => {
        expect(productSearchParams(' 4800 ')).toEqual({ EAN: '4800' });
        expect(productSearchParams('4800000000012')).toEqual({
            EAN: '4800000000012',
        });
    });

    it('sends anything else, and over-long digits, as an upper-cased name', () => {
        expect(productSearchParams('rice 5')).toEqual({ name: 'RICE 5' });
        expect(productSearchParams('48000000000123')).toEqual({
            name: '48000000000123',
        });
    });

    it('searches nothing for a blank term', () => {
        expect(productSearchParams('   ')).toEqual({});
    });
});
