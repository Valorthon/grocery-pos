<template>
    <div class="fixed top-4 right-4 z-[60] flex flex-col gap-2 items-end">
        <TransitionGroup
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0 -translate-y-2"
            enter-to-class="opacity-100 translate-y-0"
            leave-active-class="transition duration-200 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0"
        >
            <div
                v-for="toast in toasts"
                :key="toast.id"
                :class="[
                    'flex items-center gap-2.5 rounded-xl px-4 py-3 shadow-lg border text-sm font-bold',
                    colorClass(toast.color),
                ]"
            >
                <component :is="iconFor(toast.color)" :size="18" />
                <span>{{ toast.text }}</span>
                <button
                    type="button"
                    class="ml-1 text-current opacity-60 hover:opacity-100"
                    @click="dismiss(toast.id)"
                >
                    <X :size="16" />
                </button>
            </div>
        </TransitionGroup>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { CheckCircle2, AlertCircle, Info, X } from '@lucide/vue';
import { useUIStore } from '@/stores/ui';

interface Toast {
    id: number;
    color: string;
    text: string;
}

const uiStore = useUIStore();
const toasts = ref<Toast[]>([]);
let counter = 0;

function colorClass(color: string): string {
    switch (color) {
        case 'success':
            return 'bg-emerald-50 border-emerald-200 text-emerald-800';
        case 'error':
            return 'bg-red-50 border-red-200 text-red-800';
        default:
            return 'bg-slate-900 border-slate-700 text-white';
    }
}

function iconFor(color: string) {
    if (color === 'success') return CheckCircle2;
    if (color === 'error') return AlertCircle;
    return Info;
}

function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id);
}

watch(
    () => uiStore.queue.length,
    () => {
        const latest = uiStore.queue[uiStore.queue.length - 1];
        if (!latest) return;
        const id = ++counter;
        toasts.value.push({
            id,
            color: latest.color ?? 'info',
            text: latest.text ?? '',
        });
        setTimeout(() => dismiss(id), 3000);
    },
    { immediate: false },
);
</script>
