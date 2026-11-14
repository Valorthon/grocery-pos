import { describe, expect, it } from 'vitest';
import { draftTable } from '@/components/ui/draft-table';

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

/** Read the alignment binding independently of other cell attributes. */
function hasDraftTableBinding(
    attrs: string,
    binding: 'tdActions' | 'thNum',
): boolean {
    const template = document.createElement('template');
    template.innerHTML = `<div${attrs}></div>`;
    return (
        template.content.firstElementChild?.getAttribute(':class') ===
        `draftTable.${binding}`
    );
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
    /\b(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|fill|stroke|from|via|to|divide|decoration|accent|caret|placeholder|shadow)-\[(?:color:)?#[0-9a-f]{3,8}\]|\[[a-z-]*color:#[0-9a-f]{3,8}\]/i;
/** The retired `primary-*` palette (alias of `leaf-*` until #158). */
const PRIMARY_CLASS = /\bprimary-\d{2,3}\b/;

describe('colour drift (#158)', () => {
    it('has no raw hex colour class', () => {
        expect(offending(RAW_HEX_CLASS)).toEqual([]);
    });

    it('uses no primary-* colour; leaf-* replaced it', () => {
        expect(offending(PRIMARY_CLASS)).toEqual([]);
    });

    it('keeps the old brand blue out of the client, assets included', () => {
        expect(indexHtml).not.toMatch(/#075bab/i);
        expect(offending(/#075bab/i)).toEqual([]);
        const assets = import.meta.glob<string>(
            ['/src/**/*.svg', '/public/*.{svg,webmanifest}'],
            { query: '?raw', import: 'default', eager: true },
        );
        expect(Object.keys(assets)).toEqual(
            expect.arrayContaining([
                '/public/favicon.svg',
                '/public/manifest.webmanifest',
                '/src/assets/logo-icon.svg',
                '/src/assets/logo-white.svg',
            ]),
        );
        expect(
            Object.entries(assets)
                .filter(([, text]) => /#075bab/i.test(text))
                .map(([file]) => file),
        ).toEqual([]);
    });

    it.each([
        'bg-[#075BAB]',
        'text-[#fff]',
        'hover:border-[#f8fafc]',
        'stroke-[#11223344]',
        'bg-[color:#abc]',
        'border-s-[#abcdef]',
        '[background-color:#abcdef]',
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

/** FIELD_LABEL (not FIELD_LABEL_TEXT) beside a bottom-margin class. */
function labelMarginConflict(line: string): boolean {
    return (
        /\bFIELD_LABEL\b/.test(line) &&
        /(?<![\w-])-?m[by]?-[\w.[\]]+/.test(line)
    );
}

describe('field label margins (#301)', () => {
    it('recognises conflicting margins only', () => {
        for (const bad of [
            "[FIELD_LABEL, 'mb-0']",
            '`${FIELD_LABEL} mb-0`',
            "[FIELD_LABEL, 'x', ok ? 'my-2' : '']",
            "[x, FIELD_LABEL, '-mb-1']",
            "[FIELD_LABEL, 'm-0']",
        ])
            expect(labelMarginConflict(bad), bad).toBe(true);
        for (const good of [
            "[FIELD_LABEL, 'mt-2']",
            "[FIELD_LABEL_TEXT, 'mb-0']",
            ':class="FIELD_LABEL"',
            "[FIELD_LABEL, 'min-w-0 text-sm']",
        ])
            expect(labelMarginConflict(good), good).toBe(false);
    });

    it('never overrides FIELD_LABEL margin by class order', () => {
        // `mb-1.5` comes later in the stylesheet, so an added margin may
        // lose; use FIELD_LABEL_TEXT instead.
        const hits = Object.entries(sources)
            .filter(([file]) => !file.endsWith('/field-style.ts'))
            .flatMap(([file, text]) =>
                text
                    .split('\n')
                    .filter(labelMarginConflict)
                    .map((line) => `${file}: ${line.trim()}`),
            );
        expect(hits).toEqual([]);
        expect(offending(/FIELD_LABEL\.replace\(/)).toEqual([]);
    });
});

/**
 * Row actions (#311): a row opens by row-click, the rest sit in a ⋯ menu
 * under a right-aligned "Actions" column (key `actions`). No open-only
 * column comes back. Audit's `action` is a data column (the event type),
 * not a row action, so its "Action" title is allowed.
 */
describe('row actions drift (#311)', () => {
    /** A header literal: an object with both `key` and `title`, any order or quotes. */
    interface HeaderLiteral {
        file: string;
        key: string;
        title: string;
        align?: string;
    }
    const prop = (text: string, name: string) =>
        new RegExp(`\\b${name}:\\s*(['"\`])([^'"\`]*)\\1`).exec(text)?.[2];
    function headerLiterals(): HeaderLiteral[] {
        const found: HeaderLiteral[] = [];
        for (const [file, text] of Object.entries(sources))
            for (const [literal] of text.matchAll(/\{[^{}]*\}/g)) {
                const key = prop(literal, 'key');
                const title = prop(literal, 'title');
                if (key === undefined || title === undefined) continue;
                found.push({ file, key, title, align: prop(literal, 'align') });
            }
        return found;
    }
    /** The header arrays (`headers`/`baseHeaders`…) and the keys in order. */
    function headerArrays(): { file: string; keys: string[] }[] {
        const found: { file: string; keys: string[] }[] = [];
        for (const [file, text] of Object.entries(sources))
            for (const [, body] of text.matchAll(
                /eaders\b[^=\n]*=\s*(?:computed[^[]*)?\[([\s\S]*?)\n\];?/g,
            )) {
                const keys = [
                    ...body.matchAll(/\bkey:\s*(['"`])([^'"`]*)\1/g),
                ].map((m) => m[2]);
                if (keys.length) found.push({ file, keys });
            }
        return found;
    }

    it('finds the header literals', () => {
        expect(headerLiterals().length).toBeGreaterThan(30);
    });

    it('has no "Action", "Open", "Details" or "History" header outside data columns', () => {
        const bad = headerLiterals().filter(
            ({ file, key, title }) =>
                ['Open', 'Details', 'History'].includes(title) ||
                (title === 'Action' &&
                    !(
                        file.endsWith('/views/User/Audit/Index.vue') &&
                        key === 'action'
                    )),
        );
        expect(bad).toEqual([]);
        // Draft tables write their headers by hand.
        expect(offending(/>\s*(Action|Open|Details|History)\s*<\/th>/)).toEqual(
            [],
        );
    });

    it('titles every `actions` column "Actions", right-aligned and last', () => {
        const actions = headerLiterals().filter(({ key }) => key === 'actions');
        expect(actions.length).toBeGreaterThan(3);
        expect(
            actions.filter(
                ({ title, align }) => title !== 'Actions' || align !== 'right',
            ),
        ).toEqual([]);
        const arrays = headerArrays().filter(({ keys }) =>
            keys.includes('actions'),
        );
        expect(arrays.length).toBeGreaterThan(3);
        expect(
            arrays.filter(({ keys }) => keys[keys.length - 1] !== 'actions'),
        ).toEqual([]);
    });

    /** #317: the ⋯ or icon sits flush right under the right-aligned header. */
    it('right-aligns every row-actions control in its cell (#317)', () => {
        const file = (end: string) =>
            Object.entries(sources).find(([f]) => f.endsWith(end))?.[1] ?? '';
        // RowActions: the dropdown root is a flex row pushed right.
        expect(file('/components/ui/RowActions.vue')).toMatch(
            /<BaseDropdown[^>]*class="flex justify-end"/,
        );
        // DraftRowActions: its root row is pushed right too.
        expect(file('/components/ui/DraftRowActions.vue')).toMatch(
            /^<template>\s*<div class="flex justify-end/,
        );
        expect(draftTable.tdActions).toMatch(/\btext-right\b/);
        expect(draftTable.thNum).toMatch(/\btext-right\b/);
        // Every draft table: the actions cell is tdActions, the header thNum.
        const users = Object.entries(sources).filter(
            ([f, text]) =>
                f.endsWith('.vue') && /<DraftRowActions\b/.test(text),
        );
        expect(users.length).toBeGreaterThanOrEqual(4);
        for (const [f, text] of users) {
            const cells = [
                ...text.matchAll(
                    /<td\b((?:"[^"]*"|'[^']*'|[^'">])*)>\s*<DraftRowActions\b/g,
                ),
            ].map((m) => m[1]);
            const all = text.match(/<DraftRowActions\b/g)?.length ?? 0;
            expect({ f, cells: cells.length }).toEqual({ f, cells: all });
            for (const attrs of cells)
                expect({
                    f,
                    aligned: hasDraftTableBinding(attrs, 'tdActions'),
                }).toEqual({
                    f,
                    aligned: true,
                });
            const headers = [
                ...text.matchAll(
                    /<th\b((?:"[^"]*"|'[^']*'|[^'">])*)>\s*Actions\s*</g,
                ),
            ];
            expect({
                f,
                th: headers.some(([, attrs]) =>
                    hasDraftTableBinding(attrs, 'thNum'),
                ),
            }).toEqual({ f, th: true });
        }
    });

    it.each(['tdActions', 'thNum'] as const)(
        'accepts unrelated attributes and ordering around draftTable.%s (#344)',
        (binding) => {
            for (const attrs of [
                ` :class="draftTable.${binding}" aria-label="Actions > options"`,
                ` data-testid="actions" :class="draftTable.${binding}"`,
                ` aria-label="Actions" :class='draftTable.${binding}' data-row="1"`,
            ]) {
                expect(hasDraftTableBinding(attrs, binding), attrs).toBe(true);
            }
        },
    );

    it.each(['tdActions', 'thNum'] as const)(
        'rejects absent or changed draftTable.%s alignment (#344)',
        (binding) => {
            for (const attrs of [
                ' aria-label="Actions"',
                ' :class="draftTable.td" data-testid="actions"',
                ` class="draftTable.${binding}"`,
                ` aria-label=':class="draftTable.${binding}"'`,
            ]) {
                expect(hasDraftTableBinding(attrs, binding), attrs).toBe(false);
            }
        },
    );

    it('has no RowOpenButton left', () => {
        expect(offending(/RowOpenButton/)).toEqual([]);
    });
});
