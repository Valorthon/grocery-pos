<template>
    <span
        :class="[
            'inline-flex items-center gap-1 font-bold rounded-full',
            sizeClass,
            colorClass,
        ]"
    >
        <slot />
    </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
    defineProps<{
        color?:
            'success' | 'error' | 'warning' | 'info' | 'primary' | 'neutral';
        size?: 'sm' | 'md';
    }>(),
    { color: 'neutral', size: 'sm' },
);

const sizeClass = computed(() =>
    props.size === 'md' ? 'text-xs px-3 py-1' : 'text-xs px-2 py-0.5',
);

const colorClass = computed(() => {
    switch (props.color) {
        case 'success':
            return 'bg-success-bg text-success-fg border border-success-border';
        case 'error':
            return 'bg-danger-bg text-danger-fg border border-danger-border';
        case 'warning':
            return 'bg-warning-bg text-warning-fg border border-warning-border';
        case 'info':
            return 'bg-info-bg text-info-fg border border-info-border';
        case 'primary':
            return 'bg-leaf-50 text-leaf-700 border border-leaf-200';
        default:
            return 'bg-paper text-ink border border-line';
    }
});
</script>
