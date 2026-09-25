import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { click, flush, type } from '@/testing/form-dom';
import { useUIStore } from '@/stores/ui';
import RestockSaveDialog from './SaveDialog.vue';
import AdjustmentSaveDialog from '../Adjustments/SaveDialog.vue';
import type { SaveForm } from './dto';

let app: App | null = null;

beforeEach(() => {
    setActivePinia(createPinia());
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function open(
    dialog: typeof RestockSaveDialog,
    save: (form: SaveForm) => Promise<boolean>,
) {
    const isOpen = ref(true);
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () =>
            h(dialog, {
                modelValue: isOpen.value,
                'onUpdate:modelValue': (v: boolean) => (isOpen.value = v),
                save,
            }),
    });
    app.mount(host);
    await flush();
    await type('Description', 'weekly delivery');
    return isOpen;
}

const saveButton = () =>
    [...document.body.querySelectorAll('button')].find(
        (b) =>
            b.textContent?.includes('Save') ||
            b.querySelector('svg.animate-spin'),
    )!;

describe.each([
    ['restock', RestockSaveDialog],
    ['adjustment', AdjustmentSaveDialog],
])('%s save dialog (issue #18)', (_, dialog) => {
    it('stays open and busy while saving, then closes on success', async () => {
        const pending = deferred<boolean>();
        const save = vi.fn(() => pending.promise);
        const isOpen = await open(dialog, save);

        await click('Save');

        expect(save).toHaveBeenCalledWith({ description: 'weekly delivery' });
        expect(isOpen.value).toBe(true);
        const buttons = [...document.body.querySelectorAll('button')];
        expect(buttons.every((b) => b.disabled || !b.textContent?.trim())).toBe(
            true,
        );

        // Escape cannot close it mid-save.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await flush();
        expect(isOpen.value).toBe(true);

        // Nor can the backdrop.
        document.body
            .querySelector('.fixed.inset-0')!
            .dispatchEvent(new MouseEvent('mousedown'));
        await flush();
        expect(isOpen.value).toBe(true);

        pending.resolve(true);
        await flush();
        expect(isOpen.value).toBe(false);
    });

    it('stays open with the form kept when the save fails', async () => {
        const save = vi.fn(() => Promise.resolve(false));
        const isOpen = await open(dialog, save);

        await click('Save');

        expect(isOpen.value).toBe(true);
        expect(saveButton().disabled).toBe(false);
        expect(
            document.body.querySelector<HTMLInputElement>('input')?.value,
        ).toBe('weekly delivery');
    });

    it('shows a message when the save throws something unexpected', async () => {
        const bug = new TypeError('boom');
        const save = vi.fn(() => Promise.reject(bug));
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const isOpen = await open(dialog, save);

        await click('Save');

        expect(log).toHaveBeenCalledWith(bug);

        expect(isOpen.value).toBe(true);
        expect(useUIStore().toasts.map((t) => t.lines)).toEqual([
            ['Error saving. Try again.'],
        ]);
    });

    it('does not save an invalid description', async () => {
        const save = vi.fn(() => Promise.resolve(true));
        const isOpen = await open(dialog, save);
        await type('Description', '');

        await click('Save');

        expect(save).not.toHaveBeenCalled();
        expect(isOpen.value).toBe(true);
    });
});
