import { afterEach, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import {
    AxiosError,
    AxiosHeaders,
    type InternalAxiosRequestConfig,
} from 'axios';
import { ErrorCode } from '@grocery-pos/contracts';
import ClientOutdatedDialog from './ClientOutdatedDialog.vue';
import {
    clientOutdated,
    noteClientOutdated,
    reloader,
} from '@/utils/client-outdated';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    clientOutdated.value = false;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

function refusal(code: ErrorCode, status = 409) {
    const config = {
        headers: new AxiosHeaders(),
    } as InternalAxiosRequestConfig;
    return new AxiosError('refused', AxiosError.ERR_BAD_REQUEST, config, null, {
        status,
        statusText: String(status),
        data: { statusCode: status, error: code, message: 'x' },
        headers: new AxiosHeaders(),
        config,
    });
}

function mount() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(ClientOutdatedDialog);
    app.mount(host);
}

it('stays hidden until the API refuses this build (#364)', async () => {
    mount();
    await nextTick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(noteClientOutdated(refusal(ErrorCode.CONFLICT))).toBe(false);
    expect(noteClientOutdated(new Error('network'))).toBe(false);
    await nextTick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('asks for a reload with only a Reload button, and reloads on click', async () => {
    const reload = vi.spyOn(reloader, 'reload').mockImplementation(() => {});
    mount();
    expect(noteClientOutdated(refusal(ErrorCode.CLIENT_OUTDATED))).toBe(true);
    await nextTick();
    await nextTick();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Grocery POS was updated');
    expect(dialog?.textContent).toContain('Reload to continue.');
    const buttons = [...(dialog?.querySelectorAll('button') ?? [])];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Reload']);
    // Escape does not dismiss it: the old page must not keep working.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    buttons[0]!.click();
    expect(reload).toHaveBeenCalledTimes(1);
});

it('clears nothing: the basket and the offline outbox are left as they are', () => {
    const basket = 'grocery_pos_cart_v1:user';
    localStorage.setItem(basket, '{"items":[1]}');
    noteClientOutdated(refusal(ErrorCode.CLIENT_OUTDATED));
    expect(localStorage.getItem(basket)).toBe('{"items":[1]}');
    localStorage.removeItem(basket);
});
