import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, ref } from 'vue';
import { flush } from '@/testing/form-dom';
import SegmentedFilter from './SegmentedFilter.vue';

let app: App | null = null;
afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

const OPTIONS = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
];

async function mount(onUpdate: (value: string) => void) {
    const value = ref('a');
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () =>
            h(SegmentedFilter, {
                modelValue: value.value,
                options: OPTIONS,
                label: 'Pick',
                'onUpdate:modelValue': (next: string) => {
                    value.value = next;
                    onUpdate(next);
                },
            }),
    });
    app.mount(host);
    await flush();
    return host;
}

const buttons = () => [...document.querySelectorAll('button')];

describe('SegmentedFilter (#242)', () => {
    it('is a labelled group of 44px toggle buttons', async () => {
        await mount(vi.fn());
        const group = document.querySelector('[role=group]')!;
        expect(group.getAttribute('aria-label')).toBe('Pick');
        expect(buttons().map((b) => b.textContent?.trim())).toEqual([
            'Alpha',
            'Beta',
        ]);
        expect(buttons().map((b) => b.getAttribute('aria-pressed'))).toEqual([
            'true',
            'false',
        ]);
        for (const b of buttons()) {
            expect(b.type).toBe('button');
            expect(b.classList).toContain('min-h-11');
        }
    });
    it('emits a new pick and ignores the pressed one', async () => {
        const onUpdate = vi.fn();
        await mount(onUpdate);
        buttons()[0].click();
        await flush();
        expect(onUpdate).not.toHaveBeenCalled();
        buttons()[1].click();
        await flush();
        expect(onUpdate).toHaveBeenCalledExactlyOnceWith('b');
        expect(buttons()[1].getAttribute('aria-pressed')).toBe('true');
        expect(buttons()[1].dataset.value).toBe('b');
    });
});
