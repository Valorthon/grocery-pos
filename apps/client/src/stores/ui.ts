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

export const useUIStore = defineStore('ui', () => {
    const queue = ref<SnackbarMessage[]>([]);

    function queueMessage(color: Color, text: string) {
        queue.value.push({ color, text });
    }

    return { queueMessage, queue };
});
