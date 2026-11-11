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
async function mount(items?: { term: string; meaning: string }[]) {
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp({
        render: () =>
            h(InfoTooltip, { label: 'About', items }, () =>
                items ? '' : 'Note text',
            ),
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
        expect(tip.getAttribute('popover')).toBe('manual');
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
        expect(button.hasAttribute('aria-expanded')).toBe(false);
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

    it('places the note under the button with JS positions', async () => {
        const { button, tip } = await mount();
        button.getBoundingClientRect = () =>
            ({ top: 100, bottom: 144, left: 500, right: 544 }) as DOMRect;
        button.click();
        await flush();
        expect(tip.style.top).toBe('148px');
        expect(tip.className).toContain('fixed');
    });

    it('closes on Escape from anywhere while hover-open, and only the tooltip', async () => {
        const { button, tip } = await mount();
        const outer = vi.fn((e: KeyboardEvent) => e.defaultPrevented);
        document.addEventListener('keydown', outer);
        button.parentElement!.dispatchEvent(new MouseEvent('mouseenter'));
        await flush();
        document.body.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            }),
        );
        await flush();
        expect(open(tip)).toBe(false);
        expect(outer).not.toHaveBeenCalled();
        document.removeEventListener('keydown', outer);
    });

    it('renders list content as a definition list', async () => {
        const { tip } = await mount([
            { term: 'Stock', meaning: 'On hand now' },
            { term: 'Ledger', meaning: 'Sum of movements' },
        ]);
        expect(
            [...tip.querySelectorAll('dl dt')].map((d) => d.textContent),
        ).toEqual(['Stock', 'Ledger']);
        expect(tip.querySelector('dd')?.textContent).toBe('On hand now');
    });
});
