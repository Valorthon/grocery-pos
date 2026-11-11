import { describe, expect, it } from 'vitest';

/**
 * #274: the UI says "Low stock at" and "Restock amount", never "reorder"
 * or "Restock quantity". API and code names (`reorderLevel`, …) stay, so
 * only words followed by a space count, after comments are removed.
 */
const sources = import.meta.glob<string>(
    ['/src/**/*.{vue,ts}', '!/src/**/*.spec.ts', '!/src/**/testing/**'],
    { query: '?raw', import: 'default', eager: true },
);

function withoutComments(text: string): string {
    return text
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('low-stock wording (#274)', () => {
    it('scans the client sources', () => {
        expect(Object.keys(sources).length).toBeGreaterThan(50);
    });

    it.each(Object.entries(sources))('%s has no old wording', (_, text) => {
        const visible = withoutComments(text);
        expect(visible).not.toMatch(/\breorder(?![A-Za-z_])/i);
        expect(visible).not.toMatch(/\brestock quantity\b/i);
    });
});
