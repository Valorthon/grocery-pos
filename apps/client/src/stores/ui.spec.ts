import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { Color, TOAST_DEDUPE_MS, useUIStore } from './ui';

describe('ui store toasts', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.useFakeTimers();
    });

    afterEach(() => vi.useRealTimers());

    it('shows an identical message once while it is still on screen', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.ERROR, 'Please log in to continue');
        ui.queueMessage(Color.ERROR, 'Please log in to continue');

        expect(ui.queue).toHaveLength(1);
    });

    it('shows it again once the first toast is gone', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.ERROR, 'Please log in to continue');
        vi.advanceTimersByTime(TOAST_DEDUPE_MS);
        ui.queueMessage(Color.ERROR, 'Please log in to continue');

        expect(ui.queue).toHaveLength(2);
    });

    it('never drops a different message', () => {
        const ui = useUIStore();

        ui.queueMessage(Color.ERROR, 'Please log in to continue');
        ui.queueMessage(Color.ERROR, 'Update failed');
        ui.queueMessage(Color.SUCCESS, 'Please log in to continue');

        expect(ui.queue).toHaveLength(3);
    });
});
