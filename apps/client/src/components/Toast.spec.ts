import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import {
    Color,
    TOAST_DEDUPE_MS,
    TOAST_DURATION_MS,
    useUIStore,
} from '@/stores/ui';
import Toast from './Toast.vue';

let app: App | null = null;

beforeEach(() => {
    vi.useFakeTimers();
    const pinia = createPinia();
    setActivePinia(pinia);
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Toast);
    app.use(pinia);
    app.mount(host);
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
});

const toasts = () => [
    ...document.querySelectorAll<HTMLElement>('[data-testid="toast"]'),
];

describe('Toast (issue #18)', () => {
    it('renders every message queued in the same tick', async () => {
        const ui = useUIStore();
        ui.queueMessage(Color.ERROR, 'first');
        ui.queueMessage(Color.ERROR, 'second');
        ui.queueMessage(Color.SUCCESS, 'third');
        await nextTick();

        expect(toasts().map((t) => t.textContent?.trim())).toEqual([
            'first',
            'second',
            'third',
        ]);
    });

    it('announces errors as alerts and the rest as status', async () => {
        const ui = useUIStore();
        ui.queueMessage(Color.ERROR, 'Sale failed');
        ui.queueMessage(Color.SUCCESS, 'Saved');
        await nextTick();

        const [error, success] = toasts();
        expect(error.getAttribute('role')).toBe('alert');
        // Success sits in one persistent polite live region, not its own.
        expect(success.getAttribute('role')).toBeNull();
        const region = document.querySelector('[data-testid="toast-status"]')!;
        expect(region.getAttribute('aria-live')).toBe('polite');
        expect(region.contains(success)).toBe(true);
    });

    it('keeps the polite live region in the page while it is empty', () => {
        expect(
            document
                .querySelector('[data-testid="toast-status"]')
                ?.getAttribute('aria-live'),
        ).toBe('polite');
    });

    it('removes an expired success from the page', async () => {
        useUIStore().queueMessage(Color.SUCCESS, 'Saved');
        await nextTick();
        expect(toasts()).toHaveLength(1);

        vi.advanceTimersByTime(TOAST_DURATION_MS);
        await nextTick();
        // Let the leave transition finish.
        vi.advanceTimersByTime(1000);
        await nextTick();

        expect(toasts()).toHaveLength(0);
    });

    it('reads a repeat count as text, not an aria-label', async () => {
        const ui = useUIStore();
        ui.queueMessage(Color.ERROR, 'Sale failed');
        vi.advanceTimersByTime(TOAST_DEDUPE_MS);
        ui.queueMessage(Color.ERROR, 'Sale failed');
        await nextTick();

        const toast = toasts()[0];
        expect(toast.querySelector('.sr-only')?.textContent).toBe(
            '(repeated 2 times)',
        );
        expect(toast.querySelector('[aria-label^="shown"]')).toBeNull();
    });

    it('scrolls a long stack instead of covering the page', () => {
        const stack = document.querySelector('[data-testid="toast-stack"]')!;
        expect(stack.className).toContain('overflow-y-auto');
        expect(stack.className).toMatch(/max-h-/);
    });

    it('keeps an error on screen and lets a success expire', async () => {
        const ui = useUIStore();
        ui.queueMessage(Color.ERROR, 'Please log in to continue');
        ui.queueMessage(Color.SUCCESS, 'Saved');
        await nextTick();

        vi.advanceTimersByTime(TOAST_DURATION_MS * 5);
        await nextTick();

        expect(ui.toasts.map((t) => t.lines[0])).toEqual([
            'Please log in to continue',
        ]);
    });

    it('closes a toast from its labelled close button', async () => {
        const ui = useUIStore();
        ui.queueMessage(Color.ERROR, 'Sale failed');
        await nextTick();

        const close = toasts()[0].querySelector<HTMLButtonElement>(
            'button[aria-label="Dismiss notification"]',
        )!;
        close.click();
        await nextTick();

        expect(ui.toasts).toEqual([]);
    });

    it('shows a list of messages as one toast', async () => {
        useUIStore().queueMessage(Color.ERROR, ['Item 1: bad', 'Item 2: bad']);
        await nextTick();

        expect(toasts()).toHaveLength(1);
        expect(
            [...toasts()[0].querySelectorAll('li')].map((li) =>
                li.textContent?.trim(),
            ),
        ).toEqual(['Item 1: bad', 'Item 2: bad']);
    });
});

describe('Toast placement (#85)', () => {
    const stack = () =>
        document.querySelector<HTMLElement>('[data-testid="toast-stack"]')!;
    const classes = () => stack().className.split(/\s+/);

    it('sits top-right by default (the admin layout)', () => {
        expect(useUIStore().toastPlacement).toBe('top-right');
        expect(classes()).toEqual(
            expect.arrayContaining(['fixed', 'top-4', 'right-4']),
        );
        expect(classes()).not.toContain('bottom-4');
    });

    it('sits bottom-center in the seller layout', async () => {
        useUIStore().toastPlacement = 'bottom-center';
        await nextTick();
        expect(classes()).toEqual(
            expect.arrayContaining([
                'bottom-4',
                'left-1/2',
                '-translate-x-1/2',
                'items-center',
            ]),
        );
        expect(classes()).not.toContain('top-4');
        expect(classes()).not.toContain('right-4');
    });

    it('clears the Tender footer below lg on the register, and the tender panel from lg', async () => {
        useUIStore().toastPlacement = 'register';
        await nextTick();
        expect(classes()).toEqual(
            expect.arrayContaining([
                'bottom-24',
                'left-1/2',
                '-translate-x-1/2',
                'lg:bottom-4',
                'lg:left-[calc(50%-200px)]',
            ]),
        );
        expect(classes()).not.toContain('top-4');
    });

    it('keeps errors as alerts, above the rest, wherever it sits', async () => {
        const ui = useUIStore();
        ui.toastPlacement = 'register';
        ui.queueMessage(Color.SUCCESS, 'Saved');
        ui.queueMessage(Color.ERROR, 'Sale failed');
        await nextTick();

        const [error, success] = toasts();
        expect(error.textContent?.trim()).toBe('Sale failed');
        expect(error.getAttribute('role')).toBe('alert');
        expect(success.textContent?.trim()).toBe('Saved');
        expect(stack().contains(error)).toBe(true);
    });
});
