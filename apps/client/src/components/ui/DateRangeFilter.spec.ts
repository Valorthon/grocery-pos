import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, h, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import {
    field,
    fieldError,
    flush,
    openDates,
    pick,
    selectField,
    type,
} from '@/testing/form-dom';
import { useListPaging } from '@/composables/useListFetch';
import { useDatePreset } from '@/composables/useDatePreset';
import { dateRangeError } from '@/utils/rules';
import { DATE_RANGE_REVERSED } from '@/utils/rules';
import DateRangeFilter from './DateRangeFilter.vue';
import { dateRangeLabel } from './date-range-label';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

let app: App | null = null;

beforeEach(() => {
    setActivePinia(createPinia());
    api.get.mockReset().mockResolvedValue({
        data: { today: '2026-11-11', timezone: 'Asia/Manila' },
    });
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

/** A list page wiring the control as the dated lists do. */
function harness() {
    const load = vi.fn();
    const from = ref('');
    const to = ref('');
    let state!: {
        page: ReturnType<typeof useListPaging>['page'];
        reset: () => void;
    };
    const Page = defineComponent({
        setup() {
            const { page, search } = useListPaging(load);
            const { preset, choose, edited, reset } = useDatePreset(
                from,
                to,
                () => {
                    if (!dateRangeError(from.value, to.value)) search();
                },
            );
            state = {
                page,
                reset: () => {
                    reset();
                    from.value = '';
                    to.value = '';
                    search();
                },
            };
            return () =>
                h(DateRangeFilter, {
                    preset: preset.value,
                    from: from.value,
                    to: to.value,
                    error: dateRangeError(from.value, to.value),
                    'onUpdate:from': (v: string) => (from.value = v),
                    'onUpdate:to': (v: string) => (to.value = v),
                    onPreset: (v: Parameters<typeof choose>[0]) =>
                        void choose(v),
                    onEdit: () => {
                        edited();
                        if (!dateRangeError(from.value, to.value)) search();
                    },
                });
        },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Page);
    app.mount(host);
    return { load, from, to, state: () => state };
}

const trigger = () =>
    document.querySelector<HTMLButtonElement>('[data-date-range]')!;

describe('DateRangeFilter (#254)', () => {
    it('applies a preset once on page 1 with the store date and names it on the button', async () => {
        const { load, from, to, state } = harness();
        await flush();
        state().page.value = 3;
        await flush();
        load.mockClear();
        expect(trigger().textContent?.trim()).toBe('All dates');

        await openDates();
        await pick('Dates', 'This week');

        expect(api.get).toHaveBeenCalledWith('/settings/today');
        expect(load).toHaveBeenCalledTimes(1);
        expect(state().page.value).toBe(1);
        // Monday-start week.
        expect([from.value, to.value]).toEqual(['2026-11-09', '2026-11-11']);
        expect(trigger().textContent?.trim()).toBe('This week');
    });

    it('switches to Custom on a hand edit and shows the range', async () => {
        const { from } = harness();
        await openDates();
        await pick('Dates', 'Today');
        await type('From', '2026-11-01');
        await flush();
        expect(selectField('Dates').value).toBe('Custom');
        expect(from.value).toBe('2026-11-01');
        expect(trigger().textContent?.trim()).toBe('Nov 1 – Nov 11');
    });

    it('shows dateRangeError under To for a reversed range without loading', async () => {
        const { load } = harness();
        await openDates();
        load.mockClear();
        await type('To', '2026-11-01');
        await type('From', '2026-11-05');
        await flush();
        expect(fieldError('To')).toBe(DATE_RANGE_REVERSED);
        expect(load).toHaveBeenCalledTimes(1);
        expect(field('To').getAttribute('min')).toBe('2026-11-05');
    });

    it('goes back to All dates when the page clears it', async () => {
        const { state } = harness();
        await openDates();
        await pick('Dates', 'Yesterday');
        state().reset();
        await flush();
        expect(trigger().textContent?.trim()).toBe('All dates');
        expect(selectField('Dates').value).toBe('');
    });

    it('opens on the modal stack; Escape closes it and the focus returns to the button', async () => {
        harness();
        await flush();
        trigger().focus();
        await openDates();
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await flush();
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(trigger());
    });
});

describe('dateRangeLabel', () => {
    it('names presets, ranges and open ends', () => {
        expect(dateRangeLabel(null, '', '')).toBe('All dates');
        expect(dateRangeLabel('Last month', '2026-10-01', '2026-10-31')).toBe(
            'Last month',
        );
        expect(dateRangeLabel('Custom', '2026-11-01', '2026-11-11')).toBe(
            'Nov 1 – Nov 11',
        );
        expect(dateRangeLabel('Custom', '2025-12-30', '2026-01-02')).toBe(
            'Dec 30, 2025 – Jan 2, 2026',
        );
        expect(dateRangeLabel(null, '2026-11-03', '2026-11-03')).toBe('Nov 3');
        expect(dateRangeLabel('Custom', '2026-11-03', '')).toBe('From Nov 3');
        expect(dateRangeLabel('Custom', '', '2026-11-03')).toBe('Until Nov 3');
        expect(dateRangeLabel('Custom', '', '')).toBe('Custom');
    });
});
