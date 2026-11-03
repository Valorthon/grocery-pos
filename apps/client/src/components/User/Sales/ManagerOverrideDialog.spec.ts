import { createApp, nextTick, reactive, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverrideAction } from '@grocery-pos/contracts';
import ManagerOverrideDialog from './ManagerOverrideDialog.vue';
import type { ApiSend } from '@/testing/api-mock';

const api = vi.hoisted(() => ({ post: vi.fn<ApiSend>() }));
vi.mock('@/axios', () => ({ default: api }));
let app: App | undefined;
const approved = vi.fn();
const cancel = vi.fn();
const props = () =>
    reactive({
        modelValue: true,
        request: {
            action: OverrideAction.DISCOUNT,
            context: { expectedSubtotal: 1000 },
        },
        summary: 'Approve discount ₱1.00. Reason: Promotion',
        onApproved: approved,
        onCancel: cancel,
    });
async function flush() {
    for (let i = 0; i < 5; i++) await nextTick();
    await new Promise((r) => setTimeout(r, 0));
}
async function mount() {
    const p = props();
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(ManagerOverrideDialog, p);
    app.mount(host);
    await flush();
    return p;
}
function input(id: string, value: string) {
    const el = document.getElementById(id) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input'));
}
function button(label: string) {
    return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === label,
    )!;
}
beforeEach(() => {
    api.post
        .mockReset()
        .mockResolvedValue({ data: { token: 'approval-token' } });
    approved.mockReset();
    cancel.mockReset();
});
afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
});

describe('manager approval dialog (#34)', () => {
    it('describes admin-only discount authority without logging out the cashier', async () => {
        await mount();
        expect(document.body.textContent).toContain(
            'An admin must approve this discount',
        );
        expect(document.body.textContent).toContain('cashier stays logged in');
        expect(document.body.textContent).toContain('Reason: Promotion');
        expect(button('Approve action').disabled).toBe(true);
    });
    it('requires username and exactly six digits, preserving leading zeroes', async () => {
        await mount();
        input('override-manager-name', '  BOSS  ');
        for (const value of ['12345', '1234567', '123a56', ' 12345']) {
            input('override-manager-pin', value);
            await flush();
            expect(button('Approve action').disabled).toBe(true);
        }
        input('override-manager-pin', '012345');
        await flush();
        button('Approve action').click();
        await flush();
        expect(api.post).toHaveBeenCalledWith(
            '/auth/override',
            expect.objectContaining({
                username: 'boss',
                pin: '012345',
                action: OverrideAction.DISCOUNT,
            }),
        );
        expect(approved).toHaveBeenCalledWith('approval-token');
        expect(
            (
                document.getElementById(
                    'override-manager-pin',
                ) as HTMLInputElement
            ).value,
        ).toBe('');
        expect(
            (
                document.getElementById(
                    'override-manager-name',
                ) as HTMLInputElement
            ).value,
        ).toBe('');
    });
    it('offers a touchscreen keypad with deletion, clear and a six-digit cap', async () => {
        await mount();
        for (const key of ['0', '1', '2', '3', '4', '5', '6'])
            button(key).click();
        await flush();
        expect(
            (
                document.getElementById(
                    'override-manager-pin',
                ) as HTMLInputElement
            ).value,
        ).toBe('012345');
        button('⌫').click();
        await flush();
        expect(
            (
                document.getElementById(
                    'override-manager-pin',
                ) as HTMLInputElement
            ).value,
        ).toBe('01234');
        button('Clear').click();
        await flush();
        expect(
            (
                document.getElementById(
                    'override-manager-pin',
                ) as HTMLInputElement
            ).value,
        ).toBe('');
    });
    it('does not submit incomplete inputs through Enter', async () => {
        await mount();
        document
            .querySelector('form')!
            .dispatchEvent(new Event('submit', { cancelable: true }));
        await flush();
        expect(api.post).not.toHaveBeenCalled();
    });
    it('clears PIN after failure and leaves a generic inline error for retry', async () => {
        api.post.mockRejectedValueOnce(new Error('offline'));
        await mount();
        input('override-manager-name', 'boss');
        input('override-manager-pin', '012345');
        await flush();
        button('Approve action').click();
        await flush();
        expect(document.querySelector('[role="alert"]')?.textContent).toContain(
            'Manager approval failed',
        );
        expect(approved).not.toHaveBeenCalled();
        expect(
            (
                document.getElementById(
                    'override-manager-pin',
                ) as HTMLInputElement
            ).value,
        ).toBe('');
    });
    it('clears credentials and cancels without sending a request', async () => {
        await mount();
        input('override-manager-name', 'boss');
        input('override-manager-pin', '012345');
        await flush();
        button('Cancel').click();
        await flush();
        expect(cancel).toHaveBeenCalledOnce();
        expect(api.post).not.toHaveBeenCalled();
        expect(
            (
                document.getElementById(
                    'override-manager-pin',
                ) as HTMLInputElement
            ).value,
        ).toBe('');
    });
    it('locks dismissal and duplicate submission while a PIN request is in flight', async () => {
        let complete!: (value: { data: { token: string } }) => void;
        api.post.mockReturnValue(
            new Promise((r) => {
                complete = r;
            }),
        );
        await mount();
        input('override-manager-name', 'boss');
        input('override-manager-pin', '012345');
        await flush();
        button('Approve action').click();
        await flush();
        expect(button('Cancel').disabled).toBe(true);
        expect(document.querySelector('[data-modal-close]')).toBeNull();
        document
            .querySelector('form')!
            .dispatchEvent(new Event('submit', { cancelable: true }));
        await flush();
        expect(api.post).toHaveBeenCalledOnce();
        complete({ data: { token: 'token' } });
        await flush();
        expect(approved).toHaveBeenCalledWith('token');
    });
});
