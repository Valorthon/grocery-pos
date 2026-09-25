import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { click, field, fieldError, flush, type } from '@/testing/form-dom';
import { DATE_RANGE_REVERSED } from '@/utils/rules';
import { useUIStore } from '@/stores/ui';
import Index from './Index.vue';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

function httpError(status: number, message: string): AxiosError {
    const config = { headers: new AxiosHeaders() };
    return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, {
        status,
        statusText: '',
        headers: {},
        config,
        data: { statusCode: status, message },
    } as AxiosResponse);
}

const RESTOCK = {
    _id: 'r1',
    description: 'weekly delivery',
    restockedBy: { name: 'rex' },
    totalCost: 10_000,
    createdAt: '2026-09-25T01:00:00.000Z',
};

let app: App | null = null;
let pinia: Pinia;

beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    api.get.mockReset();
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
    return host;
}

const tableError = () =>
    document.querySelector<HTMLElement>('[data-testid="table-error"]');

describe('restock history errors (issue #18)', () => {
    it('shows a failed fetch in the table and retries it', async () => {
        let fail = true;
        api.get.mockImplementation((url: string) => {
            if (url === '/restocks/users') return Promise.resolve({ data: [] });
            if (fail) {
                return Promise.reject(httpError(503, 'Service unavailable'));
            }
            return Promise.resolve({
                data: { data: [RESTOCK], totalItems: 1 },
            });
        });
        const host = await mount();

        expect(tableError()?.textContent).toContain('Service unavailable');
        expect(document.querySelector('.animate-pulse')).toBeNull();

        fail = false;
        await click('Retry');

        expect(tableError()).toBeNull();
        expect(host.textContent).toContain('weekly delivery');
    });

    it('catches a malformed row instead of spinning forever', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        api.get.mockImplementation((url: string) =>
            Promise.resolve({
                data:
                    url === '/restocks/users'
                        ? []
                        : {
                              data: [{ ...RESTOCK, restockedBy: null }],
                              totalItems: 1,
                          },
            }),
        );
        await mount();

        expect(tableError()?.textContent).toContain(
            'Could not load the restocks.',
        );
        expect(log).toHaveBeenCalledWith(expect.any(TypeError));
        expect(document.querySelector('.animate-pulse')).toBeNull();
    });

    it('hides the pager beside the error: its page count is stale', async () => {
        let fail = false;
        api.get.mockImplementation((url: string) => {
            if (url === '/restocks/users') return Promise.resolve({ data: [] });
            if (fail) return Promise.reject(httpError(500, 'Boom'));
            return Promise.resolve({
                data: { data: [RESTOCK], totalItems: 30 },
            });
        });
        await mount();
        expect(document.body.textContent).toContain('Page 1 / 6');

        fail = true;
        await click('Next');

        expect(tableError()).not.toBeNull();
        expect(document.body.textContent).not.toContain('Page ');
        expect(
            [...document.querySelectorAll('button')].some(
                (b) => b.textContent?.trim() === 'Next',
            ),
        ).toBe(false);
    });

    it('reports a failed user filter as a toast and still lists', async () => {
        api.get.mockImplementation((url: string) =>
            url === '/restocks/users'
                ? Promise.reject(httpError(500, 'Internal server error'))
                : Promise.resolve({
                      data: { data: [RESTOCK], totalItems: 1 },
                  }),
        );
        const host = await mount();

        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['Internal server error'],
        ]);
        expect(host.textContent).toContain('weekly delivery');
    });
});

describe('restock history filters and paging (issue #20)', () => {
    const USERS = [
        { _id: 'u1', name: 'rex' },
        { _id: 'u2', name: 'sam' },
    ];

    function serve(totalItems = 30) {
        api.get.mockImplementation((url: string) =>
            Promise.resolve({
                data:
                    url === '/restocks/users'
                        ? USERS
                        : { data: [RESTOCK], totalItems },
            }),
        );
    }

    /** The params of every GET /restocks since the last clear. */
    const listCalls = () =>
        api.get.mock.calls
            .filter(([url]) => url === '/restocks')
            .map(([, config]) => config.params);

    const selects = () => [...document.querySelectorAll('select')];
    const userFilter = () => selects()[0]!;
    const pageSize = () => selects().slice(-1)[0]!;

    async function choose(select: HTMLSelectElement, value: string) {
        select.value = value;
        select.dispatchEvent(new Event('change'));
        await flush();
    }

    it('lists by the picked user, and by everyone again from "All users"', async () => {
        serve();
        await mount();
        const filter = userFilter();
        expect(filter.options[filter.selectedIndex]?.textContent).toContain(
            'All users',
        );
        api.get.mockClear();

        await choose(filter, 'u2');
        expect(listCalls()).toEqual([
            expect.objectContaining({ page: 1, restockedBy: 'u2' }),
        ]);

        api.get.mockClear();
        await choose(filter, '');
        expect(listCalls()).toHaveLength(1);
        expect(listCalls()[0].restockedBy).toBeUndefined();
    });

    it('goes back to page 1, in one request, when a filter changes on page 2', async () => {
        serve();
        await mount();
        await click('Next');
        expect(listCalls().slice(-1)[0]).toMatchObject({ page: 2 });
        api.get.mockClear();

        await choose(userFilter(), 'u1');

        expect(listCalls()).toEqual([
            expect.objectContaining({ page: 1, restockedBy: 'u1' }),
        ]);
    });

    it('goes back to page 1 when the page size changes', async () => {
        serve();
        await mount();
        await click('Next');
        await click('Next');
        await click('Next');
        expect(listCalls().slice(-1)[0]).toMatchObject({ page: 4, limit: 5 });
        api.get.mockClear();

        await choose(pageSize(), '50');

        expect(listCalls()).toEqual([
            expect.objectContaining({ page: 1, limit: 50 }),
        ]);
    });

    it('refuses a reversed date range on the To field and does not send it', async () => {
        serve();
        await mount();
        await type('From', '2026-03-02');
        await flush();
        expect(field('To').getAttribute('min')).toBe('2026-03-02');
        api.get.mockClear();

        await type('To', '2026-03-01');
        await flush();

        expect(fieldError('To')).toBe(DATE_RANGE_REVERSED);
        expect(listCalls()).toEqual([]);

        // Paging keeps the range the list was last loaded with.
        await click('Next');
        expect(listCalls()).toEqual([
            expect.objectContaining({
                page: 2,
                dateFrom: '2026-03-02',
                dateTo: undefined,
            }),
        ]);
        api.get.mockClear();

        await type('To', '2026-03-05');
        await flush();

        expect(fieldError('To')).toBe('');
        expect(listCalls()).toEqual([
            expect.objectContaining({
                page: 1,
                dateFrom: '2026-03-02',
                dateTo: '2026-03-05',
            }),
        ]);
    });

    it('clears every filter with one request', async () => {
        serve();
        await mount();
        await choose(userFilter(), 'u1');
        await type('From', '2026-03-02');
        await flush();
        api.get.mockClear();

        await click('Clear Filters');

        expect(listCalls()).toHaveLength(1);
        expect(listCalls()[0]).toMatchObject({
            page: 1,
            restockedBy: undefined,
            dateFrom: undefined,
            dateTo: undefined,
        });
        expect(
            userFilter().options[userFilter().selectedIndex]?.textContent,
        ).toContain('All users');
    });
});
