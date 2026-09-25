import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, defineComponent, h, nextTick, ref } from 'vue';
import { NUMERIC_LIMITS, SHIFT_LIMITS } from '@grocery-pos/contracts';
import BillCountInput from './BillCountInput.vue';
import {
    COUNTED_TOO_MUCH,
    COUNTS_INVALID,
    countsError,
    piecesError,
} from './shift';
import type { BillCounts } from './shift';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function flush() {
    for (let i = 0; i < 3; i++) await nextTick();
}

/** Mounts the input under a parent holding both v-models, as the modals do. */
async function mount(initial: BillCounts = {}) {
    const counts = ref<BillCounts>(initial);
    const invalid = ref(false);
    const Host = defineComponent({
        setup: () => () =>
            h(BillCountInput, {
                modelValue: counts.value,
                'onUpdate:modelValue': (value: BillCounts) => {
                    counts.value = value;
                },
                invalid: invalid.value,
                'onUpdate:invalid': (value: boolean) => {
                    invalid.value = value;
                },
            }),
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Host);
    app.mount(host);
    await flush();
    return { counts, invalid };
}

function field(id: string): HTMLInputElement {
    return document.querySelector<HTMLInputElement>(
        `[data-testid="count-${id}"]`,
    )!;
}

function testid(id: string): string {
    return document.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';
}

async function type(id: string, text: string) {
    const input = field(id);
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await flush();
}

function button(id: string): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
}

describe('BillCountInput (issue #25)', () => {
    it('updates the counts and subtotals on every keystroke, not on blur', async () => {
        const { counts } = await mount();

        await type('1000', '2');
        expect(counts.value).toEqual({ '1000': 2 });
        expect(testid('count-bills-subtotal')).toContain('2,000.00');

        await type('1000', '25');
        expect(counts.value).toEqual({ '1000': 25 });
        expect(testid('count-bills-subtotal')).toContain('25,000.00');

        await type('coin-25c', '3');
        expect(counts.value).toEqual({ '1000': 25, 'coin-25c': 3 });
        expect(testid('count-coins-subtotal')).toContain('0.75');
    });

    it('refuses a fractional count visibly instead of truncating it', async () => {
        const { counts, invalid } = await mount();

        await type('500', '2.5');

        expect(counts.value).toEqual({});
        expect(invalid.value).toBe(true);
        expect(field('500').value).toBe('2.5');
        expect(field('500').getAttribute('aria-invalid')).toBe('true');
        expect(testid('count-error-500')).toContain('Whole pieces only');
        expect(testid('count-bills-subtotal')).toContain('0.00');

        await type('500', '2');
        expect(counts.value).toEqual({ '500': 2 });
        expect(invalid.value).toBe(false);
        expect(document.querySelector('[data-testid="count-error-500"]')).toBe(
            null,
        );
    });

    it('refuses a negative count and junk visibly', async () => {
        const { counts, invalid } = await mount();

        await type('100', '-3');
        expect(testid('count-error-100')).toContain('negative');
        await type('50', 'abc');
        expect(testid('count-error-50')).toContain('Whole pieces only');

        expect(counts.value).toEqual({});
        expect(invalid.value).toBe(true);
    });

    it('treats a cleared field as none', async () => {
        const { counts, invalid } = await mount({ '20': 4 });
        expect(field('20').value).toBe('4');

        await type('20', '');

        expect(counts.value).toEqual({});
        expect(invalid.value).toBe(false);
    });

    it('caps + at the contracts piece limit and refuses typing past it', async () => {
        const { counts, invalid } = await mount({
            '1000': SHIFT_LIMITS.PIECES_MAX - 1,
        });

        button('count-plus-1000').click();
        await flush();
        expect(counts.value['1000']).toBe(SHIFT_LIMITS.PIECES_MAX);
        expect(button('count-plus-1000').disabled).toBe(true);

        await type('500', String(SHIFT_LIMITS.PIECES_MAX + 1));
        expect(testid('count-error-500')).toContain('At most');
        expect(counts.value['500']).toBeUndefined();
        expect(invalid.value).toBe(true);
    });

    it('steps with - and + and keeps the field in step', async () => {
        const { counts } = await mount();
        expect(button('count-minus-200').disabled).toBe(true);

        button('count-plus-200').click();
        await flush();
        button('count-plus-200').click();
        await flush();
        button('count-minus-200').click();
        await flush();

        expect(counts.value).toEqual({ '200': 1 });
        expect(field('200').value).toBe('1');
    });

    it('+ on a refused field starts again from 1 and clears the error', async () => {
        const { counts, invalid } = await mount();
        await type('200', '1.5');

        button('count-plus-200').click();
        await flush();

        expect(counts.value).toEqual({ '200': 1 });
        expect(invalid.value).toBe(false);
        expect(field('200').value).toBe('1');
    });

    it('shows a running piece count per group', async () => {
        await mount();
        expect(testid('count-bills-pieces')).toContain('0 pcs');

        await type('1000', '2');
        await type('20', '3');
        await type('coin-1', '1');

        expect(testid('count-bills-pieces')).toContain('5 pcs');
        expect(testid('count-coins-pieces')).toContain('1 pc');
        expect(testid('count-coins-pieces')).not.toContain('pcs');
    });

    it('clears every count and every refused field at once', async () => {
        const { counts, invalid } = await mount();
        expect(button('count-clear-all').disabled).toBe(true);

        await type('1000', '2');
        await type('coin-5', '0.5');
        expect(button('count-clear-all').disabled).toBe(false);

        button('count-clear-all').click();
        await flush();

        expect(counts.value).toEqual({});
        expect(invalid.value).toBe(false);
        expect(field('1000').value).toBe('');
        expect(field('coin-5').value).toBe('');
        expect(document.querySelector('[data-testid^="count-error-"]')).toBe(
            null,
        );
    });

    it('replaces what was typed when the parent resets the counts', async () => {
        const { counts, invalid } = await mount();
        await type('1000', '2');
        await type('500', 'x');

        counts.value = {};
        await flush();

        expect(field('1000').value).toBe('');
        expect(field('500').value).toBe('');
        expect(invalid.value).toBe(false);
    });
});

describe('countsError', () => {
    // ₱10,000,000 is 10,000 × ₱1,000.
    const AT_MAX = { '1000': 10_000 };

    it('accepts a count up to AMOUNT_MAX', () => {
        expect(NUMERIC_LIMITS.AMOUNT_MAX).toBe(1_000_000_000);
        expect(countsError(AT_MAX, false)).toBe('');
        expect(countsError({}, false)).toBe('');
    });

    it('refuses a total over AMOUNT_MAX, as the API does', () => {
        expect(countsError({ ...AT_MAX, 'coin-25c': 1 }, false)).toBe(
            COUNTED_TOO_MUCH,
        );
    });

    it('refuses a flagged field first', () => {
        expect(countsError({ ...AT_MAX, '500': 1 }, true)).toBe(COUNTS_INVALID);
    });
});

describe('piecesError', () => {
    it.each([
        ['', ''],
        ['0', ''],
        [' 12 ', ''],
        [String(SHIFT_LIMITS.PIECES_MAX), ''],
    ])('accepts %j', (text, expected) => {
        expect(piecesError(text)).toBe(expected);
    });

    it.each(['2.5', '1e3', 'abc', '+2', '2,000'])('refuses %j', (text) => {
        expect(piecesError(text)).toBe('Whole pieces only');
    });

    it('explains negative and too many', () => {
        expect(piecesError('-1')).toMatch(/negative/);
        expect(piecesError(String(SHIFT_LIMITS.PIECES_MAX + 1))).toMatch(
            /At most 100,000/,
        );
    });
});
