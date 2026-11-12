/** "Confirm it's you" (#310): the step-up password prompt. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, h, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { AxiosError, type AxiosResponse } from 'axios';
import { ErrorCode } from '@grocery-pos/contracts';
import type { ApiSend } from '@/testing/api-mock';
import { click, field, fieldError, flush, type } from '@/testing/form-dom';
import { Color, useUIStore } from '@/stores/ui';
import ReauthDialog from './ReauthDialog.vue';
import { WRONG_REAUTH_PASSWORD } from './reauth';

const api = vi.hoisted(() => ({ post: vi.fn<ApiSend>() }));
vi.mock('@/axios', () => ({ default: api }));

let app: App | null = null;
const open = ref(false);
const confirmed = vi.fn();
const cancel = vi.fn();

function apiError(status: number, data: unknown): AxiosError {
    return new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, null, {
        status,
        data,
    } as AxiosResponse);
}

async function mount() {
    open.value = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const pinia = createPinia();
    setActivePinia(pinia);
    app = createApp(
        defineComponent({
            render: () =>
                h(ReauthDialog, {
                    modelValue: open.value,
                    onConfirmed: () => {
                        confirmed();
                        open.value = false;
                    },
                    onCancel: () => {
                        cancel();
                        open.value = false;
                    },
                }),
        }),
    );
    app.use(pinia);
    app.mount(host);
    await flush();
}

beforeEach(() => {
    api.post.mockReset().mockResolvedValue({ data: undefined });
    confirmed.mockReset();
    cancel.mockReset();
});
afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

describe('ReauthDialog (#310)', () => {
    it('asks "Confirm it\'s you" for the own password and posts it', async () => {
        await mount();
        expect(document.body.textContent).toContain("Confirm it's you");
        await type('Your password', 'my secret pw');
        await click('Confirm');
        expect(api.post).toHaveBeenCalledWith('/auth/reauth', {
            password: 'my secret pw',
        });
        expect(confirmed).toHaveBeenCalledOnce();
    });

    it('shows a wrong password inline and stays open', async () => {
        api.post.mockRejectedValueOnce(
            apiError(403, {
                statusCode: 403,
                error: ErrorCode.USER_WRONG_PASSWORD,
                message: 'x',
            }),
        );
        await mount();
        await type('Your password', 'nope');
        await click('Confirm');
        expect(fieldError('Your password')).toBe(WRONG_REAUTH_PASSWORD);
        expect(confirmed).not.toHaveBeenCalled();
        expect(open.value).toBe(true);
    });

    it('shows the rate-limit text inline on 429', async () => {
        api.post.mockRejectedValueOnce(
            apiError(429, {
                statusCode: 429,
                error: ErrorCode.RATE_LIMITED,
                message: 'Too many attempts. Try again in 42 seconds.',
            }),
        );
        await mount();
        await type('Your password', 'guess');
        await click('Confirm');
        expect(fieldError('Your password')).toContain(
            'Try again in 42 seconds',
        );
    });

    it('other failures are a toast', async () => {
        api.post.mockRejectedValueOnce(new Error('boom'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await mount();
        const ui = useUIStore();
        const spy = vi.spyOn(ui, 'queueMessage');
        await type('Your password', 'pw');
        await click('Confirm');
        expect(spy).toHaveBeenCalledWith(Color.ERROR, expect.anything());
    });

    it('Cancel emits cancel and the password clears on close', async () => {
        await mount();
        await type('Your password', 'typed');
        await click('Cancel');
        expect(cancel).toHaveBeenCalledOnce();
        expect(api.post).not.toHaveBeenCalled();
        open.value = true;
        await flush();
        expect(field('Your password').value).toBe('');
    });
});
