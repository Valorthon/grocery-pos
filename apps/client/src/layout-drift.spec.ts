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

/** A Tailwind arbitrary colour class such as `bg-[#075BAB]`. */
const RAW_HEX_CLASS =
    /\b(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|fill|stroke|from|via|to|divide|decoration|accent|caret|placeholder|shadow)-\[#[0-9a-f]{3,8}\]/i;
/** The retired `primary-*` palette (alias of `leaf-*` until #158). */
const PRIMARY_CLASS = /\bprimary-\d{2,3}\b/;

describe('colour drift (#158)', () => {
    it('has no raw hex colour class', () => {
        expect(offending(RAW_HEX_CLASS)).toEqual([]);
    });

    it('uses no primary-* colour; leaf-* replaced it', () => {
        expect(offending(PRIMARY_CLASS)).toEqual([]);
    });

    it('keeps the old brand blue out of index.html', () => {
        expect(indexHtml).not.toMatch(/#075bab/i);
        expect(offending(/#075bab/i)).toEqual([]);
    });

    it.each([
        'bg-[#075BAB]',
        'text-[#fff]',
        'hover:border-[#f8fafc]',
        'stroke-[#11223344]',
    ])('catches the raw hex class %s (the check itself)', (cls) => {
        expect(RAW_HEX_CLASS.test(`<div class="${cls}" />`)).toBe(true);
    });

    it.each([
        'bg-primary-600',
        'hover:text-primary-700',
        'focus-visible:ring-primary-500/40',
        'border-l-primary-50',
        '--color-primary-600: #000;',
    ])('catches %s (the check itself)', (cls) => {
        expect(PRIMARY_CLASS.test(cls)).toBe(true);
    });

    it.each([
        'bg-leaf-600',
        'bg-[var(--color-leaf-600)]',
        "variant: 'primary'",
        'text-[length:0.75rem]',
    ])('lets %s through', (cls) => {
        expect(RAW_HEX_CLASS.test(cls) || PRIMARY_CLASS.test(cls)).toBe(false);
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
