import { createApp, h, nextTick, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';
import { ErrorCode } from '@grocery-pos/contracts';
import { apiErrorCode } from '@/utils/api-error';
import { isReauthCancelled, useReauth } from './useReauth';

let app: App | undefined;
function mount() {
    let reauth!: ReturnType<typeof useReauth>;
    app = createApp({
        setup() {
            reauth = useReauth();
            return () => h('div');
        },
    });
    app.mount(document.createElement('div'));
    return reauth;
}
function apiError(status: number, error: ErrorCode): AxiosError {
    return new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, null, {
        status,
        data: { statusCode: status, error, message: 'x' },
    } as AxiosResponse);
}
const required = () => apiError(403, ErrorCode.USER_REAUTH_REQUIRED);
afterEach(() => {
    app?.unmount();
    app = undefined;
});

describe('useReauth (#310)', () => {
    it('runs once without a prompt when the server does not ask', async () => {
        const r = mount();
        const run = vi.fn().mockResolvedValue('ok');
        await expect(r.withReauth(run)).resolves.toBe('ok');
        expect(run).toHaveBeenCalledOnce();
        expect(r.isReauthOpen.value).toBe(false);
    });

    it('prompts on USER_REAUTH_REQUIRED and retries once, unchanged, on success', async () => {
        const r = mount();
        const run = vi
            .fn()
            .mockRejectedValueOnce(required())
            .mockResolvedValue('saved');
        const result = r.withReauth(run);
        await nextTick();
        await Promise.resolve();
        expect(r.isReauthOpen.value).toBe(true);
        expect(run).toHaveBeenCalledOnce();
        r.completeReauth();
        await expect(result).resolves.toBe('saved');
        expect(run).toHaveBeenCalledTimes(2);
        expect(r.isReauthOpen.value).toBe(false);
    });

    it('does not retry on cancel', async () => {
        const r = mount();
        const run = vi.fn().mockRejectedValue(required());
        const result = r.withReauth(run);
        await Promise.resolve();
        await Promise.resolve();
        r.cancelReauth();
        const err = await result.catch((e: unknown) => e);
        expect(isReauthCancelled(err)).toBe(true);
        expect(run).toHaveBeenCalledOnce();
    });

    it('retries only once: a second refusal propagates', async () => {
        const r = mount();
        const run = vi.fn().mockRejectedValue(required());
        const result = r.withReauth(run);
        await Promise.resolve();
        await Promise.resolve();
        r.completeReauth();
        const err = await result.catch((e: unknown) => e);
        expect(apiErrorCode(err)).toBe(ErrorCode.USER_REAUTH_REQUIRED);
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('passes other errors through without a prompt', async () => {
        const r = mount();
        const other = apiError(403, ErrorCode.USER_LAST_ADMIN);
        await expect(r.withReauth(() => Promise.reject(other))).rejects.toBe(
            other,
        );
        expect(r.isReauthOpen.value).toBe(false);
    });

    it('a pending prompt is cancelled on unmount', async () => {
        const r = mount();
        const result = r.withReauth(() => Promise.reject(required()));
        await Promise.resolve();
        await Promise.resolve();
        app!.unmount();
        app = undefined;
        expect(isReauthCancelled(await result.catch((e: unknown) => e))).toBe(
            true,
        );
    });
});
