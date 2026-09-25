import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { fieldError, flush, type } from '@/testing/form-dom';
import { DATE_RANGE_REVERSED } from '@/utils/rules';
import Index from './Index.vue';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
        .map(([, config]) => config.params);

async function choose(value: string) {
    const select = document.querySelector('select')!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await flush();
}

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
        expect(listCalls()[0].adjustedBy).toBeUndefined();
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
