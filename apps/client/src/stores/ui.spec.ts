import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
    Color,
    MAX_TOASTS,
    TOAST_DEDUPE_MS,
    TOAST_DURATION_MS,
    useUIStore,
} from './ui';

describe('ui store toasts', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.useFakeTimers();
    });

    afterEach(() => vi.useRealTimers());

    const texts = (ui: ReturnType<typeof useUIStore>) =>
        ui.toasts.map((t) => t.lines.join(' | '));

    it('keeps every message queued in the same tick (issue #18)', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.ERROR, 'Item 1: EAN already exists');
        ui.queueMessage(Color.ERROR, 'Item 2: EAN already exists');
        ui.queueMessage(Color.SUCCESS, 'Saved');

        expect(texts(ui)).toEqual([
            'Item 1: EAN already exists',
            'Item 2: EAN already exists',
            'Saved',
        ]);
    });

    it('shows a list as one toast and ignores blank text', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.ERROR, ['a', 'b']);
        ui.queueMessage(Color.ERROR, '  ');
        ui.queueMessage(Color.ERROR, []);

        expect(ui.toasts).toHaveLength(1);
        expect(ui.toasts[0].lines).toEqual(['a', 'b']);
    });

    it('keeps an error until it is dismissed', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.ERROR, 'Sale failed');
        vi.advanceTimersByTime(TOAST_DURATION_MS * 10);
        expect(texts(ui)).toEqual(['Sale failed']);

        ui.dismiss(ui.toasts[0].id);
        expect(ui.toasts).toEqual([]);
    });

    it('drains success and info after their timeout', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.SUCCESS, 'Saved');
        ui.queueMessage(Color.INFO, 'No closed shift yet');
        vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
        expect(ui.toasts).toHaveLength(2);

        vi.advanceTimersByTime(1);
        expect(ui.toasts).toEqual([]);
    });

    it('keeps a sticky info or success until it is dismissed (#88)', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.INFO, 'Log out when you are done', {
            sticky: true,
        });
        ui.queueMessage(Color.SUCCESS, 'Saved');
        vi.advanceTimersByTime(TOAST_DURATION_MS * 10);

        expect(texts(ui)).toEqual(['Log out when you are done']);
        expect(ui.toasts[0].sticky).toBe(true);

        ui.dismiss(ui.toasts[0].id);
        expect(ui.toasts).toEqual([]);
    });

    it('keeps a sticky toast sticky when it repeats (#88)', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.INFO, 'Later', { sticky: true });
        vi.advanceTimersByTime(TOAST_DEDUPE_MS);
        ui.queueMessage(Color.INFO, 'Later', { sticky: true });
        vi.advanceTimersByTime(TOAST_DURATION_MS * 10);

        expect(ui.toasts.map((t) => [t.lines, t.count])).toEqual([
            [['Later'], 2],
        ]);
    });

    it('reads one event reported twice as one message, without a count', () => {
        const ui = useUIStore();

        // e.g. the axios interceptor and the router guard, same tick
        ui.queueMessage(Color.ERROR, 'Please log in to continue');
        vi.advanceTimersByTime(TOAST_DEDUPE_MS - 1);
        ui.queueMessage(Color.ERROR, 'Please log in to continue');

        expect(ui.toasts).toHaveLength(1);
        expect(ui.toasts[0].count).toBe(1);
    });

    it('counts a genuine repeat of a message still on screen', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.ERROR, 'Sale failed');
        vi.advanceTimersByTime(TOAST_DEDUPE_MS);
        ui.queueMessage(Color.ERROR, 'Sale failed');
        vi.advanceTimersByTime(TOAST_DEDUPE_MS);
        ui.queueMessage(Color.ERROR, 'Sale failed');

        expect(ui.toasts).toHaveLength(1);
        expect(ui.toasts[0].count).toBe(3);
    });

    it('clears every toast', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.ERROR, 'Sale failed');
        ui.queueMessage(Color.SUCCESS, 'Saved');
        ui.clear();
        expect(ui.toasts).toEqual([]);

        // Timers of cleared toasts are gone; a new one is not affected.
        ui.queueMessage(Color.ERROR, 'Sale failed');
        vi.advanceTimersByTime(TOAST_DURATION_MS);
        expect(texts(ui)).toEqual(['Sale failed']);
        expect(ui.toasts[0].count).toBe(1);
    });

    it('shows it again once the first one is gone', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.ERROR, 'Please log in to continue');
        ui.dismiss(ui.toasts[0].id);
        ui.queueMessage(Color.ERROR, 'Please log in to continue');
        expect(ui.toasts).toHaveLength(1);
        expect(ui.toasts[0].count).toBe(1);

        ui.queueMessage(Color.SUCCESS, 'Saved');
        vi.advanceTimersByTime(TOAST_DURATION_MS);
        ui.queueMessage(Color.SUCCESS, 'Saved');
        expect(texts(ui)).toEqual(['Please log in to continue', 'Saved']);
    });

    it('restarts a timed toast when it repeats', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.SUCCESS, 'Saved');
        vi.advanceTimersByTime(TOAST_DURATION_MS - 100);
        ui.queueMessage(Color.SUCCESS, 'Saved');
        vi.advanceTimersByTime(200);

        expect(texts(ui)).toEqual(['Saved']);
        expect(ui.toasts[0].count).toBe(2);
    });

    it('never drops a different message', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.ERROR, 'Please log in to continue');
        ui.queueMessage(Color.ERROR, 'Update failed');
        ui.queueMessage(Color.SUCCESS, 'Please log in to continue');

        expect(ui.toasts).toHaveLength(3);
    });

    it(`caps the stack at ${MAX_TOASTS}, dropping the oldest non-error first`, () => {
        const ui = useUIStore();

        ui.queueMessage(Color.SUCCESS, 'ok 1');
        ui.queueMessage(Color.ERROR, 'error 1');
        ui.queueMessage(Color.INFO, 'info 1');
        ui.queueMessage(Color.ERROR, 'error 2');
        ui.queueMessage(Color.ERROR, 'error 3');
        ui.queueMessage(Color.ERROR, 'error 4');
        expect(texts(ui)).toEqual([
            'error 1',
            'info 1',
            'error 2',
            'error 3',
            'error 4',
        ]);

        ui.queueMessage(Color.ERROR, 'error 5');
        expect(texts(ui)).toEqual([
            'error 1',
            'error 2',
            'error 3',
            'error 4',
            'error 5',
        ]);

        // Only errors left: the oldest error goes.
        ui.queueMessage(Color.ERROR, 'error 6');
        expect(texts(ui)).toEqual([
            'error 2',
            'error 3',
            'error 4',
            'error 5',
            'error 6',
        ]);
    });

    it('never drops the toast just added, even when all others are errors', () => {
        const ui = useUIStore();

        for (let i = 1; i <= MAX_TOASTS; i++) {
            ui.queueMessage(Color.ERROR, `error ${i}`);
        }
        ui.queueMessage(Color.SUCCESS, 'Saved');

        expect(texts(ui)).toEqual([
            'error 2',
            'error 3',
            'error 4',
            'error 5',
            'Saved',
        ]);
    });

    it('drops an older success before an error to make room', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.ERROR, 'error 1');
        ui.queueMessage(Color.SUCCESS, 'ok 1');
        ui.queueMessage(Color.ERROR, 'error 2');
        ui.queueMessage(Color.ERROR, 'error 3');
        ui.queueMessage(Color.ERROR, 'error 4');
        ui.queueMessage(Color.INFO, 'info 1');

        expect(texts(ui)).toEqual([
            'error 1',
            'error 2',
            'error 3',
            'error 4',
            'info 1',
        ]);
    });

    it('drops a timed toast before a sticky one, and a sticky one before an error (#88)', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.INFO, 'sticky', { sticky: true });
        ui.queueMessage(Color.ERROR, 'error 1');
        ui.queueMessage(Color.SUCCESS, 'ok 1');
        ui.queueMessage(Color.ERROR, 'error 2');
        ui.queueMessage(Color.ERROR, 'error 3');
        ui.queueMessage(Color.ERROR, 'error 4');

        expect(texts(ui)).toEqual([
            'sticky',
            'error 1',
            'error 2',
            'error 3',
            'error 4',
        ]);

        ui.queueMessage(Color.ERROR, 'error 5');

        expect(texts(ui)).toEqual([
            'error 1',
            'error 2',
            'error 3',
            'error 4',
            'error 5',
        ]);
    });
});
