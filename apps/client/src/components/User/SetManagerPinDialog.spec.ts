import { createApp, h, nextTick, reactive, type App } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, Role, type UserView } from '@grocery-pos/contracts';
import { AxiosError, type AxiosResponse } from 'axios';
import { type } from '@/testing/form-dom';
import SetManagerPinDialog from './SetManagerPinDialog.vue';
import type { ApiSend } from '@/testing/api-mock';
const api = vi.hoisted(() => ({
    patch: vi.fn<ApiSend>(),
    post: vi.fn<ApiSend>(),
}));
vi.mock('@/axios', () => ({ default: api }));
let app: App | undefined;
const close = vi.fn();
const user: UserView = {
    _id: 'manager-id',
    name: 'manager',
    roles: [Role.Admin],
    isActive: true,
    createdAt: '',
    updatedAt: '',
};
async function flush() {
    for (let i = 0; i < 5; i++) await nextTick();
    await new Promise((r) => setTimeout(r, 0));
}
async function mount() {
    const p = reactive({
        user: { ...user } as UserView | null,
        onClose: close,
    });
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp({
        setup: () => () =>
            h(SetManagerPinDialog, { user: p.user, onClose: close }),
    });
    app.use(createPinia());
    app.mount(host);
    await flush();
    return p;
}
function button(label: string) {
    return [...document.querySelectorAll<HTMLButtonElement>('button')]
        .reverse()
        .find((b) => b.textContent?.trim() === label)!;
}
function pin(value: string) {
    const input = document.querySelector<HTMLInputElement>(
        'input[type=password]',
    )!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
}
beforeEach(() => {
    api.patch.mockReset().mockResolvedValue({ data: undefined });
    api.post.mockReset().mockResolvedValue({ data: undefined });
    close.mockReset();
});
afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
});
describe('admin manager PIN management', () => {
    it('waits for six digits and confirms setting the named manager PIN', async () => {
        await mount();
        expect(button('Set PIN').disabled).toBe(true);
        pin('012345');
        await flush();
        button('Set PIN').click();
        await flush();
        expect(document.body.textContent).toContain(
            'Replace the PIN for manager',
        );
        expect(api.patch).not.toHaveBeenCalled();
        button('Set PIN').click();
        await flush();
        expect(api.patch).toHaveBeenCalledWith(
            '/users/manager-id/override-pin',
            { pin: '012345' },
        );
        expect(close).toHaveBeenCalledOnce();
        expect(
            document.querySelector<HTMLInputElement>('input[type=password]')!
                .value,
        ).toBe('');
    });
    it('removes a PIN only after explicit confirmation', async () => {
        await mount();
        button('Remove PIN').click();
        await flush();
        expect(document.body.textContent).toContain(
            'Remove the PIN for manager',
        );
        expect(api.patch).not.toHaveBeenCalled();
        button('Remove PIN').click();
        await flush();
        expect(api.patch).toHaveBeenCalledWith(
            '/users/manager-id/override-pin',
            { pin: null },
        );
        expect(close).toHaveBeenCalledOnce();
    });
    it('cancels a PIN replacement without changing it', async () => {
        await mount();
        pin('012345');
        await flush();
        button('Set PIN').click();
        await flush();
        button('Cancel').click();
        await flush();
        expect(api.patch).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
    });
    it('clears the secret on cancel and when another user is selected', async () => {
        const p = await mount();
        pin('012345');
        await flush();
        button('Cancel').click();
        await flush();
        expect(close).toHaveBeenCalledOnce();
        expect(
            document.querySelector<HTMLInputElement>('input[type=password]')!
                .value,
        ).toBe('');
        pin('123456');
        await flush();
        p.user = { ...user, name: 'other' };
        await flush();
        expect(
            document.querySelector<HTMLInputElement>('input[type=password]')!
                .value,
        ).toBe('');
    });
    it('shows failures inline and retains the dialog for a retry', async () => {
        api.patch.mockRejectedValueOnce(new Error('offline'));
        await mount();
        pin('012345');
        await flush();
        button('Set PIN').click();
        await flush();
        button('Set PIN').click();
        await flush();
        expect(document.querySelector('[role=alert]')?.textContent).toContain(
            'Could not update manager PIN',
        );
        expect(close).not.toHaveBeenCalled();
    });
    it('prevents duplicate requests and dismissal during save', async () => {
        let finish!: (value: { data: unknown }) => void;
        api.patch.mockReturnValue(
            new Promise((r) => {
                finish = r;
            }),
        );
        await mount();
        pin('012345');
        await flush();
        button('Set PIN').click();
        await flush();
        button('Set PIN').click();
        await flush();
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(button('Cancel').disabled).toBe(true);
        expect(button('Remove PIN').disabled).toBe(true);
        expect(document.querySelector('[data-modal-close]')).toBeNull();
        button('Remove PIN').click();
        await flush();
        expect(api.patch).toHaveBeenCalledOnce();
        finish({ data: undefined });
        await flush();
    });
    it.each([
        ['Set PIN', '012345'],
        ['Remove PIN', null],
    ])(
        '%s asks "Confirm it\'s you" when the server needs a step-up, then retries (#310)',
        async (label, value) => {
            api.patch.mockRejectedValueOnce(
                new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, null, {
                    status: 403,
                    data: {
                        statusCode: 403,
                        error: ErrorCode.USER_REAUTH_REQUIRED,
                        message: 'x',
                    },
                } as AxiosResponse),
            );
            await mount();
            if (value) pin(value);
            await flush();
            button(label).click();
            await flush();
            button(label).click();
            await flush();
            expect(document.body.textContent).toContain("Confirm it's you");
            expect(close).not.toHaveBeenCalled();
            await type('Your password', 'admin-password');
            button('Confirm').click();
            await flush();
            expect(api.post).toHaveBeenCalledWith('/auth/reauth', {
                password: 'admin-password',
            });
            expect(api.patch).toHaveBeenCalledTimes(2);
            expect(api.patch).toHaveBeenLastCalledWith(
                '/users/manager-id/override-pin',
                { pin: value },
            );
            expect(close).toHaveBeenCalledOnce();
        },
    );
    it('a cancelled step-up saves nothing and keeps the dialog (#310)', async () => {
        api.patch.mockRejectedValueOnce(
            new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, null, {
                status: 403,
                data: {
                    statusCode: 403,
                    error: ErrorCode.USER_REAUTH_REQUIRED,
                    message: 'x',
                },
            } as AxiosResponse),
        );
        await mount();
        button('Remove PIN').click();
        await flush();
        button('Remove PIN').click();
        await flush();
        button('Cancel').click();
        await flush();
        expect(api.patch).toHaveBeenCalledOnce();
        expect(close).not.toHaveBeenCalled();
        expect(document.querySelector('[role=alert]')).toBeNull();
    });
});
