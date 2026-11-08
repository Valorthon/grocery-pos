<template>
    <div
        :class="[
            'flex flex-col gap-1 rounded-card border p-4 shadow-card',
            toneClass,
        ]"
    >
        <div class="flex items-center justify-between gap-2">
            <p class="text-xs font-semibold text-muted">{{ label }}</p>
            <span v-if="$slots.icon" class="text-muted" aria-hidden="true">
                <slot name="icon" />
            </span>
        </div>
        <p
            class="font-display num text-2xl font-extrabold text-ink leading-tight"
        >
            {{ value }}
        </p>
        <p v-if="hint" class="text-xs text-muted">{{ hint }}</p>
        <slot />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
    defineProps<{
        label: string;
        /** Already formatted (formatCurrency, quantity formatting, …). */
        value: string | number;
        hint?: string;
        /** Border accent only; the text stays ink/muted on surface. */
        tone?: 'neutral' | 'success' | 'warning' | 'danger';
    }>(),
    { hint: undefined, tone: 'neutral' },
);

const toneClass = computed(() => {
    switch (props.tone) {
        case 'success':
            return 'bg-surface border-success-border';
        case 'warning':
            return 'bg-surface border-warning-border';
        case 'danger':
            return 'bg-surface border-danger-border';
        default:
            return 'bg-surface border-line';
    }
});
</script>
