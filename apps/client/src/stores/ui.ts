import { ref } from 'vue';
import { defineStore } from 'pinia';

export interface SnackbarMessage {
    color?: string;
    text?: string;
}

export enum Color {
    INFO = 'info',
    SUCCESS = 'success',
    ERROR = 'error',
}

/** How long a toast stays up (Toast.vue); a repeat within it is dropped. */
export const TOAST_DEDUPE_MS = 3000;

export const useUIStore = defineStore('ui', () => {
    const queue = ref<SnackbarMessage[]>([]);
    const lastShown = new Map<string, number>();

    /**
     * Shows a toast, unless the identical one was queued less than
     * TOAST_DEDUPE_MS ago and is still on screen: e.g. a failed refresh at
     * start-up is reported by both the axios interceptor and the router
     * guard, and should read as one "Please log in to continue".
     */
    function queueMessage(color: Color, text: string) {
        const key = `${color}|${text}`;
        const now = Date.now();
        const last = lastShown.get(key);
        if (last !== undefined && now - last < TOAST_DEDUPE_MS) return;
        lastShown.set(key, now);
        queue.value.push({ color, text });
    }

    return { queueMessage, queue };
});
