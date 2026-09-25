<template>
    <button
        :type="type"
        :disabled="disabled || loading"
        :class="classes"
        @click="emit('click', $event)"
    >
        <Spinner v-if="loading" size="sm" class="text-current" />
        <span v-else class="inline-flex items-center gap-2">
            <slot name="icon" />
            <slot />
        </span>
    </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Spinner from './Spinner.vue';

const props = withDefaults(
    defineProps<{
        variant?: 'primary' | 'outline' | 'ghost' | 'danger';
        size?: 'sm' | 'md' | 'lg';
        type?: 'button' | 'submit';
        disabled?: boolean;
        loading?: boolean;
        block?: boolean;
    }>(),
    {
        variant: 'primary',
        size: 'md',
        type: 'button',
        disabled: false,
        loading: false,
        block: false,
    },
);

const emit = defineEmits<{ (e: 'click', ev: MouseEvent): void }>();

const base =
    'inline-flex items-center justify-center font-bold rounded-xl transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none focus-ring';

const variants: Record<string, string> = {
    primary:
        'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-xs',
    outline:
        'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-xs',
    ghost: 'text-slate-700 hover:bg-slate-100',
    danger: 'text-red-600 hover:bg-red-50',
};

const sizes: Record<string, string> = {
    sm: 'text-xs px-3 py-1.5',
    md: 'text-sm px-4 py-2.5',
    lg: 'text-base px-5 py-3.5',
};

const classes = computed(() => [
    base,
    variants[props.variant],
    sizes[props.size],
    props.block ? 'w-full' : '',
]);
</script>
