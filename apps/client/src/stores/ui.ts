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

/**
 * An identical message queued again within this window is the same event
 * reported twice (e.g. a failed refresh seen by both the axios
 * interceptor and the router guard): it is dropped, not counted.
 */
export const TOAST_DEDUPE_MS = 1000;

/**
 * Where the toast stack sits (#85). `top-right` everywhere but the seller
 * layout, which sets `bottom-center`, or `register` on the register:
 * bottom-center above its sticky Tender footer below lg, and centred
 * under the ticket (left of the tender panel) from lg.
 */
export type ToastPlacement = 'top-right' | 'bottom-center' | 'register';

const keyOf = (color: Color, lines: string[]) => `${color}|${lines.join('\n')}`;

export const useUIStore = defineStore('ui', () => {
    const toasts = ref<ToastMessage[]>([]);
    /** Set by SellerLayout while it is mounted (#85). */
    const toastPlacement = ref<ToastPlacement>('top-right');
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    /** When each on-screen toast was last queued (for TOAST_DEDUPE_MS). */
    const lastQueued = new Map<number, number>();
    let nextId = 0;

    function dismiss(id: number) {
        const timer = timers.get(id);
        if (timer !== undefined) clearTimeout(timer);
        timers.delete(id);
        lastQueued.delete(id);
        toasts.value = toasts.value.filter((t) => t.id !== id);
    }

    /**
     * Removes every toast. The auth store calls it when the session
     * changes, so one cashier's errors never stay up for the next.
     */
    function clear() {
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
        lastQueued.clear();
        toasts.value = [];
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

    /** Makes room for `added`, never dropping it. */
    function enforceCap(added: number) {
        while (toasts.value.length > MAX_TOASTS) {
            const others = toasts.value.filter((t) => t.id !== added);
            const victim =
                others.find((t) => t.color !== Color.ERROR) ?? others[0];
            dismiss(victim.id);
        }
    }

    /**
     * Shows a toast. `text` may be a list (e.g. `apiErrorMessages`), shown
     * as one toast for the one failed action. Errors stay until the user
     * closes them; success and info close after TOAST_DURATION_MS.
     *
     * An identical message already on screen is not repeated. Queued
     * again within TOAST_DEDUPE_MS it is the same event and is dropped;
     * later, it is a genuine repeat: its count goes up (and a timed one
     * restarts its clock).
     */
    function queueMessage(color: Color, text: string | string[]) {
        const lines = (Array.isArray(text) ? text : [text]).filter(
            (line) => line.trim() !== '',
        );
        if (lines.length === 0) return;

        const key = keyOf(color, lines);
        const same = toasts.value.find((t) => keyOf(t.color, t.lines) === key);
        const now = Date.now();
        if (same) {
            const last = lastQueued.get(same.id) ?? 0;
            lastQueued.set(same.id, now);
            if (now - last < TOAST_DEDUPE_MS) return;
            same.count += 1;
            scheduleExpiry(same);
            return;
        }

        const toast: ToastMessage = { id: ++nextId, color, lines, count: 1 };
        toasts.value.push(toast);
        lastQueued.set(toast.id, now);
        scheduleExpiry(toast);
        enforceCap(toast.id);
    }

    return { toasts, toastPlacement, queueMessage, dismiss, clear };
});
