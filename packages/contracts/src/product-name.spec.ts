import { describe, expect, it } from 'vitest';
import {
    PRODUCT_NAME_CHARACTERS_MESSAGE,
    hasValidProductNameCharacters,
    describeInvalidProductName,
    invalidProductNames,
    normalizeProductName,
    planProductNameUppercase,
} from './product-name.js';

describe('normalizeProductName (#443)', () => {
    it('trims and uppercases', () => {
        expect(normalizeProductName('  E2E Test Rice 1kg ')).toBe(
            'E2E TEST RICE 1KG',
        );
    });

    it('turns curly apostrophes and no-break spaces into plain ones (#483)', () => {
        expect(normalizeProductName('Mama\u2019s \u2018Best\u2019')).toBe(
            "MAMA'S 'BEST'",
        );
        expect(normalizeProductName('\u00A0Rice\u00A01kg\u00A0')).toBe(
            'RICE 1KG',
        );
    });
});

describe('planProductNameUppercase (#443)', () => {
    it('plans the rows that change and nothing else', () => {
        const plan = planProductNameUppercase(
            [
                { id: 'a', name: 'rice' },
                { id: 'b', name: 'MILK' },
            ],
            50,
        );
        expect(plan).toEqual({
            updates: [{ id: 'a', from: 'rice', to: 'RICE' }],
            collisions: [],
            tooLong: [],
        });
    });

    it('is idempotent on uppercased names', () => {
        expect(
            planProductNameUppercase([{ id: 'a', name: 'RICE' }], 50).updates,
        ).toEqual([]);
    });

    it('reports names that collide after uppercasing', () => {
        const plan = planProductNameUppercase(
            [
                { id: 'a', name: 'rice' },
                { id: 'b', name: 'RICE' },
                { id: 'c', name: 'milk' },
            ],
            50,
        );
        expect(plan.collisions).toEqual([{ name: 'RICE', ids: ['a', 'b'] }]);
    });

    it('reports names that grow past the limit', () => {
        // German sharp s uppercases to two letters.
        const plan = planProductNameUppercase([{ id: 'a', name: 'ßß' }], 3);
        expect(plan.tooLong).toEqual([{ id: 'a', to: 'SSSS' }]);
    });
});

describe('product name characters (#483)', () => {
    it.each([
        'PIÑA',
        'CAFÉ CON LECHE',
        'CAFÉ', // combining accent
        "MAMA'S RICE 1/2 (5KG) 10% OFF, A&B. X-1",
    ])('accepts %j', (name) => {
        expect(hasValidProductNameCharacters(name)).toBe(true);
    });

    it.each([
        'QA 🍎 APPLE',
        'A<B>',
        'A"B',
        'A$',
        'A#',
        'A@',
        'A!',
        'A_B',
        'A\tB',
        'A½',
        'A²',
        '1\uFE0F\u20E3', // keycap 1️⃣
        'A\u20DD', // enclosing circle
        'A\uFE0F', // variation selector
        'A\u{E0100}', // ideographic variation selector
        'A\u180B', // Mongolian FVS
    ])('refuses %j', (name) => {
        expect(hasValidProductNameCharacters(name)).toBe(false);
    });

    it('reports only the stored names that break the rule', () => {
        expect(
            invalidProductNames([
                { id: 'a', name: 'RICE' },
                { id: 'b', name: 'QA 🍎 APPLE' },
                { id: 'c', name: 'Mama\u2019s\u00A0rice' },
            ]),
        ).toEqual([{ id: 'b', name: 'QA 🍎 APPLE' }]);
    });

    it('names every allowed symbol in the message', () => {
        for (const ch of ". , - & ' / ( ) %".split(' '))
            expect(PRODUCT_NAME_CHARACTERS_MESSAGE).toContain(ch);
    });

    it('describes an offender by barcode, name and archive state', () => {
        expect(
            describeInvalidProductName({
                EAN: '4006381333931',
                name: 'QA 🍎 APPLE',
                isActive: false,
            }),
        ).toBe('4006381333931 – QA 🍎 APPLE (archived)');
        expect(describeInvalidProductName({ EAN: '1', name: 'A$' })).toBe(
            '1 – A$',
        );
        expect(describeInvalidProductName({ name: 'A$' })).toBe(
            '(no barcode) – A$',
        );
    });
});
