<template>
    <div
        data-testid="toast"
        :data-color="toast.color"
        :class="[
            'flex items-start gap-2.5 rounded-xl px-4 py-3 shadow-lg border text-sm font-bold',
            colorClass(toast.color),
        ]"
    >
        <component
            :is="iconFor(toast.color)"
            :size="18"
            class="shrink-0 mt-px"
            aria-hidden="true"
        />
        <div class="min-w-0 break-words">
            <span v-if="toast.lines.length === 1">{{ toast.lines[0] }}</span>
            <ul v-else class="list-disc pl-4 space-y-0.5">
                <li v-for="(line, i) in toast.lines" :key="i">
                    {{ line }}
                </li>
            </ul>
        </div>
        <template v-if="toast.count > 1">
            <span
                class="shrink-0 rounded-full bg-current/10 px-1.5 text-xs"
                aria-hidden="true"
                >×{{ toast.count }}</span
            >
            <span class="sr-only">(repeated {{ toast.count }} times)</span>
        </template>
        <button
            type="button"
            class="ml-1 shrink-0 text-current opacity-60 hover:opacity-100"
            aria-label="Dismiss notification"
            @click="emit('dismiss')"
        >
            <X :size="16" aria-hidden="true" />
        </button>
    </div>
</template>

<script setup lang="ts">
import { AlertCircle, CheckCircle2, Info, X } from '@lucide/vue';
import { Color, type ToastMessage } from '@/stores/ui';

defineProps<{ toast: ToastMessage }>();
const emit = defineEmits<{ (e: 'dismiss'): void }>();

function colorClass(color: Color): string {
    switch (color) {
        case Color.SUCCESS:
            return 'bg-emerald-50 border-emerald-200 text-emerald-800';
        case Color.ERROR:
            return 'bg-red-50 border-red-200 text-red-800';
        default:
            return 'bg-slate-900 border-slate-700 text-white';
    }
}

function iconFor(color: Color) {
    if (color === Color.SUCCESS) return CheckCircle2;
    if (color === Color.ERROR) return AlertCircle;
    return Info;
}
</script>
