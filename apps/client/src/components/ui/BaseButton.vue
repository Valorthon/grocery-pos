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
        variant?:
            | 'primary'
            | 'accent'
            | 'outline'
            | 'ghost'
            | 'danger'
            | 'danger-solid';
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

/*
 * Fresh market tokens (#155). Background colours live only in the variant
 * classes, never in `base`: Tailwind's CSS order, not class order, decides
 * which of two same-property classes wins.
 */
const base =
    'inline-flex items-center justify-center font-bold rounded-control transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none focus-ring';

const variants: Record<string, string> = {
    primary:
        'bg-leaf-600 text-white hover:bg-leaf-700 active:bg-leaf-800 shadow-card',
    // Citrus takes ink text: white on citrus fails WCAG AA.
    accent: 'bg-citrus-500 text-ink hover:bg-citrus-400 active:bg-citrus-600 shadow-card',
    outline:
        'bg-surface text-ink border border-line-strong hover:bg-paper shadow-card',
    ghost: 'text-ink hover:bg-paper',
    danger: 'text-danger-fg hover:bg-danger-bg',
    'danger-solid': 'bg-danger-solid text-white hover:bg-danger-fg shadow-card',
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
