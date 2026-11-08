import { describe, expect, it } from 'vitest';

/**
 * The Fresh market tokens (#153): the values approved on the Phase 0 tile
 * (#152) and WCAG AA contrast for every pair that carries text or a border.
 */
const css = Object.values(
    import.meta.glob<string>('/src/assets/main.css', {
        query: '?raw',
        import: 'default',
        eager: true,
    }),
)[0];

function tokens(): Map<string, string> {
    const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    const map = new Map<string, string>();
    for (const [, name, value] of theme.matchAll(
        /--color-([\w-]+):\s*([^;]+);/g,
    )) {
        map.set(name, value.trim());
    }
    return map;
}

const map = tokens();

function hex(name: string): string {
    let value = map.get(name);
    for (let i = 0; value?.startsWith('var(') && i < 5; i++) {
        value = map.get(/var\(--color-([\w-]+)\)/.exec(value)?.[1] ?? '');
    }
    if (!value || !/^#[0-9a-f]{6}$/i.test(value)) {
        throw new Error(`--color-${name} is not a hex colour: ${value}`);
    }
    return value.toLowerCase();
}

function luminance(colour: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(colour.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(hex(a)), luminance(hex(b))].sort(
        (x, y) => y - x,
    );
    return (hi + 0.05) / (lo + 0.05);
}

describe('theme tokens (#153)', () => {
    it('match the values approved on #152', () => {
        const approved: Record<string, string> = {
            paper: '#faf7f0',
            surface: '#ffffff',
            line: '#e8e2d4',
            'line-strong': '#8a958c',
            ink: '#1d2a22',
            muted: '#536359',
            'success-bg': '#e6f2e8',
            'success-fg': '#1a5c32',
            'success-border': '#a9d1b2',
            'warning-bg': '#fdf1d8',
            'warning-fg': '#7a4a00',
            'warning-border': '#efc87a',
            'danger-bg': '#fbe7e4',
            'danger-fg': '#a3261b',
            'danger-border': '#eeb1a8',
            'danger-solid': '#b42318',
            'info-bg': '#e4eef7',
            'info-fg': '#1d4f80',
            'info-border': '#a9c6e2',
        };
        const leaf =
            '#eef6ef #d6ead9 #aed5b5 #7fba8a #4f9a60 #2f8046 #1f6b3a #19572f #154626 #11391f #0a2213'.split(
                ' ',
            );
        [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].forEach(
            (step, i) => (approved[`leaf-${step}`] = leaf[i]),
        );
        const citrus = '#fff7e6 #feebbf #f5b83d #f2a516 #d68a06 #8a5604'.split(
            ' ',
        );
        [50, 100, 400, 500, 600, 700].forEach(
            (step, i) => (approved[`citrus-${step}`] = citrus[i]),
        );
        for (const [name, value] of Object.entries(approved)) {
            expect(hex(name), name).toBe(value);
        }
    });

    it('has no primary-* alias left (#158)', () => {
        expect([...map.keys()].filter((k) => k.startsWith('primary'))).toEqual(
            [],
        );
        expect(map.has('teal-dark')).toBe(false);
    });

    it.each([
        ['ink', 'paper'],
        ['ink', 'surface'],
        ['ink', 'line'],
        ['muted', 'paper'],
        ['muted', 'surface'],
        ['muted', 'line'],
        ['surface', 'leaf-600'],
        ['leaf-600', 'paper'],
        ['leaf-100', 'leaf-900'],
        ['ink', 'citrus-500'],
        ['muted', 'leaf-50'],
        ['citrus-700', 'paper'],
        ['surface', 'danger-solid'],
        ['success-fg', 'success-bg'],
        ['warning-fg', 'warning-bg'],
        ['danger-fg', 'danger-bg'],
        ['info-fg', 'info-bg'],
        // BaseButton hover/active and Badge primary (#155).
        ['ink', 'citrus-400'],
        ['ink', 'citrus-600'],
        ['surface', 'danger-fg'],
        ['surface', 'leaf-700'],
        // Also the seller sidebar's active cart badge (#161).
        ['surface', 'leaf-800'],
        ['leaf-700', 'leaf-50'],
        // Guest footer button hover: leaf text on leaf-50 (#158).
        ['leaf-600', 'leaf-50'],
        // Dark leaf admin sidebar (#160): items, headings, icons, brand,
        // error line and the profile box (hover leaf-700).
        ['leaf-300', 'leaf-900'],
        ['leaf-200', 'leaf-900'],
        ['leaf-200', 'leaf-800'],
        ['leaf-200', 'leaf-700'],
        ['leaf-100', 'leaf-800'],
        ['surface', 'leaf-900'],
        ['danger-border', 'leaf-900'],
        // Login market panel (#168): text over its leaf-700 → leaf-950 gradient.
        ['leaf-100', 'leaf-700'],
        ['leaf-100', 'leaf-950'],
        ['surface', 'leaf-950'],
        // Register dialogs (#165): Shift In/Out totals card figure (labels
        // are leaf-200/leaf-800, above) and the coin + pressed state.
        ['leaf-300', 'leaf-800'],
        ['warning-fg', 'citrus-100'],
    ])('%s text on %s passes AA (4.5:1)', (fg, bg) => {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });

    it.each([
        // Also the Reports chart zero line on its bg-surface box (#158).
        ['line-strong', 'surface'],
        ['leaf-500', 'surface'],
        ['leaf-500', 'paper'],
        // StatTile tone stripes (#157).
        ['success-fg', 'surface'],
        ['warning-fg', 'surface'],
        ['danger-fg', 'surface'],
        // focus-ring-inverse on the dark sidebar and its hover (#160).
        ['leaf-200', 'leaf-900'],
        ['leaf-200', 'leaf-800'],
    ])('%s on %s passes AA for non-text (3:1)', (fg, bg) => {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
    });

    it('draws only the peso sign from the Peso Sign face, listed first', () => {
        const face = /@font-face\s*\{[^}]*'Peso Sign'[^}]*\}/.exec(css)?.[0];
        expect(face).toMatch(/unicode-range:\s*U\+20B1;/);
        expect(face).toMatch(/@fontsource-variable\/bricolage-grotesque\//);
        expect(css).toMatch(
            /--font-sans:\s*'Peso Sign', 'Instrument Sans Variable'/,
        );
        expect(css).toMatch(/--font-display:\s*'Bricolage Grotesque Variable'/);
        expect(css).not.toMatch(/Poppins/);
    });

    it('declares only latin and latin-ext font files, and caps weights at 700', () => {
        const files = [...css.matchAll(/files\/([\w-]+)\.woff2/g)].map(
            ([, f]) => f,
        );
        expect(files.length).toBeGreaterThan(0);
        for (const f of files) expect(f).toMatch(/-latin(-ext)?-wght-normal$/);
        expect(css).toMatch(/--font-weight-extrabold: 700;/);
        expect(css).toMatch(/--font-weight-black: 700;/);
    });

    it('has a tabular-figures utility and a leaf focus ring', () => {
        expect(css).toMatch(
            /@utility num\s*\{\s*font-variant-numeric: tabular-nums;/,
        );
        expect(css).toMatch(/outline: 2px solid var\(--color-leaf-500\)/);
    });

    it('has a leaf-200 inverse focus ring for dark surfaces (#160)', () => {
        expect(css).toMatch(
            /@utility focus-ring-inverse\s*\{\s*&:focus-visible\s*\{\s*outline: 2px solid var\(--color-leaf-200\);/,
        );
    });
});
