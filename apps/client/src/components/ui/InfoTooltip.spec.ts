import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, type App } from 'vue';
import { flush } from '@/testing/form-dom';
import InfoTooltip from './InfoTooltip.vue';

let app: App | undefined;
afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
});
async function mount() {
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp({
        render: () => h(InfoTooltip, { label: 'About' }, () => 'Note text'),
    });
    app.mount(host);
    await flush();
    const button = document.querySelector<HTMLButtonElement>(
        '[data-info-tooltip]',
    )!;
    const tip = document.getElementById(
        button.getAttribute('aria-describedby')!,
    )!;
    return { button, tip };
}
const open = (tip: HTMLElement) => !tip.classList.contains('hidden');

describe('InfoTooltip (#258)', () => {
    it('is a 44px labelled button described by a role=tooltip note', async () => {
        const { button, tip } = await mount();
        expect(button.getAttribute('aria-label')).toBe('About');
        expect(button.className).toContain('min-h-11');
        expect(tip.getAttribute('role')).toBe('tooltip');
        expect(tip.textContent).toBe('Note text');
        expect(tip.hasAttribute('style')).toBe(false);
        expect(open(tip)).toBe(false);
    });

    it('opens on hover and closes when the pointer leaves', async () => {
        const { button, tip } = await mount();
        button.parentElement!.dispatchEvent(new MouseEvent('mouseenter'));
        await flush();
        expect(open(tip)).toBe(true);
        button.parentElement!.dispatchEvent(new MouseEvent('mouseleave'));
        await flush();
        expect(open(tip)).toBe(false);
    });

    it('toggles on a tap', async () => {
        const { button, tip } = await mount();
        button.click();
        await flush();
        expect(open(tip)).toBe(true);
        expect(button.getAttribute('aria-expanded')).toBe('true');
        button.click();
        await flush();
        expect(open(tip)).toBe(false);
    });

    it('opens on focus; Escape closes it and stops there', async () => {
        const { button, tip } = await mount();
        const outer = vi.fn();
        document.addEventListener('keydown', outer);
        button.focus();
        await flush();
        expect(open(tip)).toBe(true);
        button.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await flush();
        expect(open(tip)).toBe(false);
        expect(outer).not.toHaveBeenCalled();
        button.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        expect(outer).toHaveBeenCalledTimes(1);
        document.removeEventListener('keydown', outer);
        button.blur();
        button.focus();
        await flush();
        expect(open(tip)).toBe(true);
    });
});
