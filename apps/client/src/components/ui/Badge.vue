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
            return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
        case 'error':
            return 'bg-red-50 text-red-700 border border-red-200';
        case 'warning':
            return 'bg-amber-50 text-amber-700 border border-amber-200';
        case 'info':
            return 'bg-sky-50 text-sky-800 border border-sky-200';
        case 'primary':
            return 'bg-primary-50 text-primary-700 border border-primary-200';
        default:
            return 'bg-slate-100 text-slate-700 border border-slate-200';
    }
});
</script>
