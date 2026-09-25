import { describe, expect, it } from 'vitest';

/**
 * Source checks for issue #26, like the other drift specs: they fail the
 * day someone brings back what was removed.
 */
const sources = import.meta.glob<string>(
    ['/src/**/*.{vue,ts,css}', '!/src/**/*.spec.ts'],
    { query: '?raw', import: 'default', eager: true },
);
const indexHtml = Object.values(
    import.meta.glob<string>('/index.html', {
        query: '?raw',
        import: 'default',
        eager: true,
    }),
)[0];

function offending(pattern: RegExp): string[] {
    return Object.entries(sources)
        .filter(([, text]) => pattern.test(text))
        .map(([file]) => file);
}

describe('layout drift (#26)', () => {
    it('reads the sources', () => {
        expect(Object.keys(sources).length).toBeGreaterThan(50);
        expect(indexHtml).toContain('<div id="app">');
    });

    it('has no text smaller than 12px (text-xs)', () => {
        const tooSmall: string[] = [];
        for (const [file, text] of Object.entries(sources)) {
            for (const [size, value, unit] of text.matchAll(
                /text-\[(\d*\.?\d+)(px|rem|em)\]/g,
            )) {
                const px = Number(value) * (unit === 'px' ? 1 : 16);
                if (px < 12) tooSmall.push(`${file}: ${size}`);
            }
        }
        expect(tooSmall).toEqual([]);
    });

    it('loads no runtime asset from a third-party host', () => {
        const hosts = [
            'images.unsplash.com',
            'fonts.googleapis.com',
            'fonts.gstatic.com',
        ];
        for (const host of hosts) {
            expect(offending(new RegExp(host.replace(/\./g, '\\.')))).toEqual(
                [],
            );
            expect(indexHtml).not.toContain(host);
        }
    });
});
