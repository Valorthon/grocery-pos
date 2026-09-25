import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { Color, MAX_TOASTS, TOAST_DURATION_MS, useUIStore } from './ui';

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

    it('collapses an identical message on screen into a count', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.ERROR, 'Please log in to continue');
        ui.queueMessage(Color.ERROR, 'Please log in to continue');

        expect(ui.toasts).toHaveLength(1);
        expect(ui.toasts[0].count).toBe(2);
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
});
