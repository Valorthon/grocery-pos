import { describe, expect, it } from 'vitest';
import {
    normalizeProductName,
    planProductNameUppercase,
} from './product-name.js';

describe('normalizeProductName (#443)', () => {
    it('trims and uppercases', () => {
        expect(normalizeProductName('  E2E Test Rice 1kg ')).toBe(
            'E2E TEST RICE 1KG',
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
