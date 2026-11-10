import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import {
    click,
    field,
    fieldError,
    flush,
    pick,
    selectField,
    type,
} from '@/testing/form-dom';
import { DATE_RANGE_REVERSED } from '@/utils/rules';
import Index from './Index.vue';
import type { ApiGet } from '@/testing/api-mock';

const api = vi.hoisted(() => ({ get: vi.fn<ApiGet>() }));
vi.mock('@/axios', () => ({ default: api }));
vi.mock('vue-router', () => ({
    useRouter: () => ({ push: vi.fn() }),
    useRoute: () => ({
        name: 'X',
        meta: { title: 'Adjustment history' },
        query: {},
    }),
}));

const ADJUSTMENT = {
    _id: 'a1',
    description: 'weekly count',
    adjustedBy: { name: 'ada' },
    createdAt: '2026-09-25T01:00:00.000Z',
};

let app: App | null = null;
let pinia: Pinia;

beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    api.get.mockReset().mockImplementation((url: string) =>
        Promise.resolve({
            data:
                url === '/adjustments/users'
                    ? [{ _id: 'u1', name: 'ada' }]
                    : url === '/settings/today'
                      ? { today: '2026-11-10', timezone: 'Asia/Manila' }
                      : { data: [ADJUSTMENT], totalItems: 1 },
        }),
    );
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Index);
    app.use(pinia);
    app.mount(host);
    await flush();
}

const listCalls = () =>
    api.get.mock.calls
        .filter(([url]) => url === '/adjustments')
        .map(([, config]) => config?.params);

async function choose(value: string) {
    const select = document.querySelector('select')!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await flush();
}

describe('adjustment history rows (#27)', () => {
    it('lists an adjustment whose adjuster account is gone as N/A', async () => {
        // `adjustedBy` is populated by name, and null once the user is
        // gone (contracts AdjustmentRow): a valid row, not a failed load.
        api.get.mockImplementation((url) =>
            Promise.resolve({
                data:
                    url === '/adjustments/users'
                        ? []
                        : {
                              data: [{ ...ADJUSTMENT, adjustedBy: null }],
                              totalItems: 1,
                          },
            }),
        );
        await mount();

        expect(document.body.textContent).toContain('weekly count');
        expect(document.body.textContent).toContain('N/A');
    });
});

describe('adjustment history filters (issue #20)', () => {
    it('lists by the picked user, and by everyone again from "All users"', async () => {
        await mount();
        api.get.mockClear();

        await choose('u1');
        expect(listCalls()).toEqual([
            expect.objectContaining({ page: 1, adjustedBy: 'u1' }),
        ]);

        api.get.mockClear();
        await choose('');
        expect(listCalls()).toHaveLength(1);
        expect(listCalls()[0]?.adjustedBy).toBeUndefined();
    });

    it('refuses a reversed date range without sending it', async () => {
        await mount();
        await type('From', '2026-03-02');
        await flush();
        api.get.mockClear();

        await type('To', '2026-03-01');
        await flush();

        expect(fieldError('To')).toBe(DATE_RANGE_REVERSED);
        expect(listCalls()).toEqual([]);
    });
});

describe('adjustment history date presets (#215)', () => {
    const clearButton = () =>
        [...document.querySelectorAll('button')].find((b) =>
            b.textContent?.includes('Clear Filters'),
        )!;

    it('a preset sets both dates from the server today and loads page 1 once', async () => {
        await mount();
        api.get.mockClear();

        await pick('Dates', 'Last month');

        expect(api.get).toHaveBeenCalledWith('/settings/today');
        expect(listCalls()).toEqual([
            expect.objectContaining({
                page: 1,
                dateFrom: '2026-10-01',
                dateTo: '2026-10-31',
            }),
        ]);
    });

    it('a manual date edit switches the preset to Custom', async () => {
        await mount();
        await pick('Dates', 'Yesterday');
        expect(field('From').value).toBe('2026-11-09');
        await type('To', '2026-11-10');
        await flush();
        expect(selectField('Dates').value).toBe('Custom');
    });

    it('Clear Filters is disabled at defaults and resets the preset with one load', async () => {
        await mount();
        expect(clearButton().disabled).toBe(true);
        await pick('Dates', 'Last 30 days');
        expect(clearButton().disabled).toBe(false);
        api.get.mockClear();

        await click('Clear Filters');

        expect(listCalls()).toEqual([
            expect.objectContaining({ page: 1, dateFrom: undefined }),
        ]);
        expect(selectField('Dates').value).not.toBe('Last 30 days');
        expect(clearButton().disabled).toBe(true);
    });
});
