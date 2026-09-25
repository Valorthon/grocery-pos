import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, h } from 'vue';
import BaseInput from './BaseInput.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

function mount(props: Record<string, unknown>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({ render: () => h(BaseInput, props) });
    app.mount(host);
    return host.querySelector('input')!;
}

describe('BaseInput maxlength', () => {
    it('puts maxlength on the input itself', () => {
        expect(mount({ maxlength: 30 }).getAttribute('maxlength')).toBe('30');
    });

    it('leaves it off when not given', () => {
        expect(mount({}).hasAttribute('maxlength')).toBe(false);
    });
});
