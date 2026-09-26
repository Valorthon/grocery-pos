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

function toPx(value: string, unit: string): number {
    return Number(value) * (unit === 'px' ? 1 : 16);
}

/** The CSS in a file: all of a .css file, a .vue file's <style> blocks. */
function styleSheets(file: string, text: string): string[] {
    if (file.endsWith('.css')) return [text];
    if (!file.endsWith('.vue')) return [];
    return [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(
        ([, css]) => css,
    );
}

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
            // Tailwind arbitrary sizes, with or without a `length:` hint.
            for (const [size, value, unit] of text.matchAll(
                /text-\[(?:length:)?(\d*\.?\d+)(px|rem|em)\]/g,
            )) {
                if (toPx(value, unit) < 12) tooSmall.push(`${file}: ${size}`);
            }
            // `font-size:` in CSS files and in .vue <style> blocks.
            for (const css of styleSheets(file, text)) {
                for (const [size, value, unit] of css.matchAll(
                    /font-size\s*:\s*(\d*\.?\d+)(px|rem|em)\b/g,
                )) {
                    if (toPx(value, unit) < 12) {
                        tooSmall.push(`${file}: ${size}`);
                    }
                }
            }
        }
        expect(tooSmall).toEqual([]);
    });

    it('finds a small size where it is written (the check itself)', () => {
        const vue =
            '<template><p class="text-[length:0.6rem]" /></template>\n<style scoped>\n.a { font-size: 10px; }\n.b { font-size: clamp(1rem, 2vw, 2rem); }\n</style>';
        expect(
            [...vue.matchAll(/text-\[(?:length:)?(\d*\.?\d+)(px|rem|em)\]/g)]
                .length,
        ).toBe(1);
        const css = styleSheets('/src/x.vue', vue).join('');
        expect(
            [...css.matchAll(/font-size\s*:\s*(\d*\.?\d+)(px|rem|em)\b/g)].map(
                ([, v, u]) => toPx(v, u),
            ),
        ).toEqual([10]);
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

    it('has no static style="" attribute or inline script/style (CSP, #29)', () => {
        // nginx sends style-src 'self' and script-src 'self' with no
        // 'unsafe-inline'. A static style="" works until Vue happens to
        // stringify its block into innerHTML, then the browser drops it;
        // use a class or a <style> block (:style bindings are fine).
        const vue = Object.fromEntries(
            Object.entries(sources).filter(([file]) => file.endsWith('.vue')),
        );
        const staticStyle = Object.entries(vue)
            .filter(([, text]) => /\sstyle="/.test(text))
            .map(([file]) => file);
        expect(staticStyle).toEqual([]);
        expect(indexHtml).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
        expect(indexHtml).not.toMatch(/<style\b|\sstyle="/);
    });
});

describe('wording drift (#85)', () => {
    // Whole words only: "design in" is fine, "signed out" is not.
    const SIGN = /\bsign(?:ed|ing)?[\s-]?(out|in)\b/i;

    it('says "Log out" and "Log in", never "Sign out" or "Sign in"', () => {
        expect(offending(SIGN)).toEqual([]);
        expect(indexHtml).not.toMatch(SIGN);
    });

    it('matches the wording it bans, and nothing inside other words', () => {
        for (const text of [
            'Sign out',
            'sign-in',
            'Signout',
            'SignIn',
            'signed out',
            'Signing in…',
        ]) {
            expect(text).toMatch(SIGN);
        }
        for (const text of [
            'design in',
            'design-out',
            'assign in',
            'signal out',
            'signing inventory',
            'Log out',
        ]) {
            expect(text).not.toMatch(SIGN);
        }
    });
});
