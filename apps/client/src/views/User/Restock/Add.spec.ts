import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, type Component, createApp } from 'vue';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { flush, type } from '@/testing/form-dom';
import { Color, useUIStore } from '@/stores/ui';
import RestockAdd from './Add.vue';
import AdjustmentAdd from '../Adjustments/Add.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));
const push = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

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

let app: App | null = null;
let pinia: Pinia;

beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    api.post.mockReset();
    push.mockReset();
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

const saveButtons = () =>
    [...document.body.querySelectorAll('button')].filter((b) =>
        b.textContent?.includes('Save'),
    );

const dialogTitle = () =>
    [...document.querySelectorAll('h2')].map((h) => h.textContent?.trim());

async function saveDraft(page: Component) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(page);
    app.use(pinia);
    app.mount(host);
    await flush();

    // The page's Save opens the dialog; the dialog's own Save is last.
    saveButtons()[0].click();
    await flush();
    await type('Description', 'weekly delivery');
    const buttons = saveButtons();
    buttons[buttons.length - 1].click();
    await flush();
}

describe.each([
    ['restock', RestockAdd, 'Save Restock Info', 'Restocks'],
    ['adjustment', AdjustmentAdd, 'Save Adjustment Info', 'Adjustments'],
])('%s draft save (issue #18)', (_, page, title, list) => {
    it('keeps the dialog open and shows the error when the save fails', async () => {
        api.post.mockRejectedValueOnce(httpError(400, 'Items too many'));
        await saveDraft(page);

        expect(dialogTitle()).toContain(title);
        expect(document.body.style.overflow).toBe('hidden');
        expect(push).not.toHaveBeenCalled();
        expect(useUIStore().toasts.map((t) => [t.color, t.lines])).toEqual([
            [Color.ERROR, ['Items too many']],
        ]);
    });

    it('closes the dialog and leaves the page once saved', async () => {
        api.post.mockResolvedValueOnce({ data: {} });
        await saveDraft(page);

        // Closed: BaseModal releases the page scroll at once (its leave
        // transition may keep the markup for a frame).
        expect(document.body.style.overflow).toBe('');
        expect(push).toHaveBeenCalledWith({ name: list });
        expect(useUIStore().toasts.map((t) => t.color)).toEqual([
            Color.SUCCESS,
        ]);
    });
});
