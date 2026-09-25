<template>
    <div
        class="fixed top-4 right-4 z-[60] flex flex-col gap-2 items-end max-w-[calc(100vw-2rem)] sm:max-w-md"
    >
        <TransitionGroup
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="opacity-0 -translate-y-2"
            enter-to-class="opacity-100 translate-y-0"
            leave-active-class="transition duration-200 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0"
        >
            <div
                v-for="toast in uiStore.toasts"
                :key="toast.id"
                :role="toast.color === Color.ERROR ? 'alert' : 'status'"
                :aria-live="
                    toast.color === Color.ERROR ? 'assertive' : 'polite'
                "
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
                    <span v-if="toast.lines.length === 1">{{
                        toast.lines[0]
                    }}</span>
                    <ul v-else class="list-disc pl-4 space-y-0.5">
                        <li v-for="(line, i) in toast.lines" :key="i">
                            {{ line }}
                        </li>
                    </ul>
                </div>
                <span
                    v-if="toast.count > 1"
                    class="shrink-0 rounded-full bg-current/10 px-1.5 text-xs"
                    :aria-label="`shown ${toast.count} times`"
                    >×{{ toast.count }}</span
                >
                <button
                    type="button"
                    class="ml-1 shrink-0 text-current opacity-60 hover:opacity-100"
                    aria-label="Dismiss notification"
                    @click="uiStore.dismiss(toast.id)"
                >
                    <X :size="16" aria-hidden="true" />
                </button>
            </div>
        </TransitionGroup>
    </div>
</template>

<script setup lang="ts">
import { CheckCircle2, AlertCircle, Info, X } from '@lucide/vue';
import { Color, useUIStore } from '@/stores/ui';

/**
 * Every queued message, stacked (issue #18). Errors stay until closed and
 * are announced (`role="alert"`); success and info close by themselves
 * (the store times them) and are announced politely.
 */
const uiStore = useUIStore();

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
