import { afterEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h } from 'vue';
import { flush } from '@/testing/form-dom';
import RowOpenButton from './RowOpenButton.vue';

let app: App | null = null;
afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

describe('RowOpenButton (#242)', () => {
    it('is a 44×44 labelled button that emits open once per click', async () => {
        const onOpen = vi.fn();
        const host = document.createElement('div');
        document.body.appendChild(host);
        app = createApp({
            render: () =>
                h(RowOpenButton, {
                    label: 'Open milk',
                    'data-testid': 'open',
                    onOpen,
                }),
        });
        app.mount(host);
        await flush();
        const button = host.querySelector('button')!;
        expect(button.getAttribute('aria-label')).toBe('Open milk');
        expect(button.dataset.testid).toBe('open');
        for (const c of ['min-h-11', 'min-w-11', 'w-11', 'h-11'])
            expect(button.classList).toContain(c);
        expect(button.querySelector('svg')).not.toBeNull();
        button.click();
        await flush();
        expect(onOpen).toHaveBeenCalledOnce();
    });
});
