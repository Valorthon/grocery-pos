import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { click, flush } from '@/testing/form-dom';
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
