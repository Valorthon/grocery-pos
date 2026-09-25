import { containsRegex, escapeRegex, prefixRegex } from './regex';

const SPECIALS = [
    '(',
    '*',
    '+',
    'a.b',
    '[x]',
    'c++',
    '^$',
    'a|b',
    '\\',
    '{2}',
    '?',
];

describe('escapeRegex', () => {
    it.each(SPECIALS)('makes %p match only itself', (input) => {
        const pattern = new RegExp(escapeRegex(input));

        expect(pattern.test(input)).toBe(true);
        expect(pattern.test('zzz')).toBe(false);
    });
});

describe('containsRegex (product names, issue #14)', () => {
    it('matches the term anywhere in the value', () => {
        const pattern = new RegExp(containsRegex('milk').$regex);

        expect(pattern.test('milk')).toBe(true);
        expect(pattern.test('fresh milk 1l')).toBe(true);
        expect(pattern.test('mil')).toBe(false);
    });

    it.each(SPECIALS)('takes %p literally', (input) => {
        const pattern = new RegExp(containsRegex(input).$regex);

        expect(pattern.test(`x ${input} y`)).toBe(true);
        expect(pattern.test('zzz')).toBe(false);
    });

    it('does not let a term like ".*" match everything', () => {
        const pattern = new RegExp(containsRegex('.*').$regex);

        expect(pattern.test('bread')).toBe(false);
    });
});

describe('prefixRegex (barcodes)', () => {
    it('matches only at the start', () => {
        const pattern = new RegExp(prefixRegex('480').$regex);

        expect(pattern.test('4800016')).toBe(true);
        expect(pattern.test('1480016')).toBe(false);
    });

    it('takes the term literally', () => {
        expect(prefixRegex('4.0')).toEqual({ $regex: '^4\\.0' });
    });
});
