import { describe, expect, it } from 'vitest';

/**
 * #328: the app issues no official receipts, so no client text may say
 * "Official Receipt" except the disclaimer "This is not an official receipt."
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

describe('official receipt wording (#328)', () => {
    it('scans the client sources', () => {
        expect(Object.keys(sources).length).toBeGreaterThan(50);
    });

    it.each(Object.entries(sources))(
        '%s claims no official receipt',
        (_, text) => {
            const visible = withoutComments(text).replace(
                /This is not an official receipt\./g,
                '',
            );
            expect(visible).not.toMatch(/\bofficial\s+receipts?\b/i);
        },
    );
});
