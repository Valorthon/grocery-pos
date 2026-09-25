import { ref } from 'vue';
import { defineStore } from 'pinia';

export enum Color {
    INFO = 'info',
    SUCCESS = 'success',
    ERROR = 'error',
}

/** A message on screen (Toast.vue renders every one of them). */
export interface ToastMessage {
    id: number;
    color: Color;
    /** One line, or several shown as a list (one failed action). */
    lines: string[];
    /** How many times the identical message was queued while shown. */
    count: number;
}

/** How long a success or info toast stays up. Errors stay until closed. */
export const TOAST_DURATION_MS = 4000;

/**
 * The most toasts on screen at once. A burst past it drops the oldest
 * success/info first (they would close by themselves anyway), and only
 * then the oldest error, so what needs attention stays visible.
 */
export const MAX_TOASTS = 5;

const keyOf = (color: Color, lines: string[]) => `${color}|${lines.join('\n')}`;

export const useUIStore = defineStore('ui', () => {
    const toasts = ref<ToastMessage[]>([]);
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    let nextId = 0;

    function dismiss(id: number) {
        const timer = timers.get(id);
        if (timer !== undefined) clearTimeout(timer);
        timers.delete(id);
        toasts.value = toasts.value.filter((t) => t.id !== id);
    }

    function scheduleExpiry(toast: ToastMessage) {
        if (toast.color === Color.ERROR) return;
        const old = timers.get(toast.id);
        if (old !== undefined) clearTimeout(old);
        timers.set(
            toast.id,
            setTimeout(() => dismiss(toast.id), TOAST_DURATION_MS),
        );
    }

    function enforceCap() {
        while (toasts.value.length > MAX_TOASTS) {
            const victim =
                toasts.value.find((t) => t.color !== Color.ERROR) ??
                toasts.value[0];
            dismiss(victim.id);
        }
    }

    /**
     * Shows a toast. `text` may be a list (e.g. `apiErrorMessages`), shown
     * as one toast for the one failed action. Errors stay until the user
     * closes them; success and info close after TOAST_DURATION_MS.
     *
     * An identical message already on screen is not repeated: its count
     * goes up (and a timed one restarts its clock). E.g. a failed refresh
     * at start-up is reported by both the axios interceptor and the router
     * guard, and reads as one "Please log in to continue".
     */
    function queueMessage(color: Color, text: string | string[]) {
        const lines = (Array.isArray(text) ? text : [text]).filter(
            (line) => line.trim() !== '',
        );
        if (lines.length === 0) return;

        const key = keyOf(color, lines);
        const same = toasts.value.find((t) => keyOf(t.color, t.lines) === key);
        if (same) {
            same.count += 1;
            scheduleExpiry(same);
            return;
        }

        const toast: ToastMessage = { id: ++nextId, color, lines, count: 1 };
        toasts.value.push(toast);
        scheduleExpiry(toast);
        enforceCap();
    }

    return { toasts, queueMessage, dismiss };
});
