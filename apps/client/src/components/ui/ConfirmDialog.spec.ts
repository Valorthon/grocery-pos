import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp, defineComponent, h } from 'vue';
import { flush } from '@/testing/form-dom';
import { useConfirm } from '@/composables/useConfirm';
import ConfirmDialog from './ConfirmDialog.vue';

let app: App | null = null;

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

function mount() {
    let api!: ReturnType<typeof useConfirm>;
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(
        defineComponent({
            setup() {
                api = useConfirm();
                return () =>
                    h(ConfirmDialog, {
                        request: api.request.value,
                        onAnswer: api.answer,
                    });
            },
        }),
    );
    app.mount(host);
    return api;
}

const ask = (confirm: ReturnType<typeof useConfirm>['confirm']) =>
    confirm({
        title: 'Clear drafts?',
        message: 'Clear all 2 drafts?',
        confirmLabel: 'Clear',
        cancelLabel: 'Keep',
        danger: true,
    });

const button = (text: string) =>
    [...document.body.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === text,
    )!;

describe('ConfirmDialog with useConfirm (issue #19)', () => {
    it('shows the question and focuses the safe choice', async () => {
        const { confirm } = mount();
        void ask(confirm);
        await flush();

        expect(document.body.textContent).toContain('Clear all 2 drafts?');
        expect(document.activeElement).toBe(button('Keep'));
    });

    it('resolves true for the action and false for Cancel', async () => {
        const { confirm } = mount();
        const yes = ask(confirm);
        await flush();
        button('Clear').click();
        expect(await yes).toBe(true);

        const no = ask(confirm);
        await flush();
        button('Keep').click();
        expect(await no).toBe(false);
    });

    it('treats Escape and the backdrop as Cancel', async () => {
        const { confirm } = mount();
        const escaped = ask(confirm);
        await flush();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(await escaped).toBe(false);

        const backdrop = ask(confirm);
        await flush();
        document.body
            .querySelector('.fixed.inset-0')!
            .dispatchEvent(new MouseEvent('mousedown'));
        expect(await backdrop).toBe(false);
    });

    it('answers an earlier question false when asked again', async () => {
        const { confirm } = mount();
        const first = ask(confirm);
        const second = ask(confirm);
        expect(await first).toBe(false);
        await flush();
        button('Clear').click();
        expect(await second).toBe(true);
    });

    it('answers false when the page goes away', async () => {
        const { confirm } = mount();
        const pending = ask(confirm);
        await flush();
        app!.unmount();
        app = null;
        expect(await pending).toBe(false);
    });
});
