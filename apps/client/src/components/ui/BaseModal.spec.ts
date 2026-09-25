import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, h, ref } from 'vue';
import { flush } from '@/testing/form-dom';
import BaseModal from './BaseModal.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

/** Two modals, the second opened over the first (issue #19). */
async function mountStacked() {
    const lower = ref(false);
    const upper = ref(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () => [
            h(BaseModal, {
                modelValue: lower.value,
                'onUpdate:modelValue': (v: boolean) => (lower.value = v),
                title: 'Lower',
            }),
            h(BaseModal, {
                modelValue: upper.value,
                'onUpdate:modelValue': (v: boolean) => (upper.value = v),
                title: 'Upper',
            }),
        ],
    });
    app.mount(host);
    lower.value = true;
    await flush();
    upper.value = true;
    await flush();
    return { lower, upper };
}

const escape = async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();
};

describe('stacked BaseModals (issue #19)', () => {
    it('lets Escape close only the topmost one', async () => {
        const { lower, upper } = await mountStacked();

        await escape();
        expect(upper.value).toBe(false);
        expect(lower.value).toBe(true);

        await escape();
        expect(lower.value).toBe(false);
    });

    it('keeps the page locked until the last one closes', async () => {
        const { lower, upper } = await mountStacked();
        expect(document.body.style.overflow).toBe('hidden');

        upper.value = false;
        await flush();
        expect(document.body.style.overflow).toBe('hidden');

        lower.value = false;
        await flush();
        expect(document.body.style.overflow).toBe('');
    });

    it('unlocks when the page goes away with modals open', async () => {
        await mountStacked();
        app!.unmount();
        app = null;
        expect(document.body.style.overflow).toBe('');
    });
});
