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
import {
    buttonClass,
    type ButtonSize,
    type ButtonVariant,
} from './button-class';

const props = withDefaults(
    defineProps<{
        variant?: ButtonVariant;
        size?: ButtonSize;
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

const classes = computed(() =>
    buttonClass(props.variant, props.size, props.block),
);
</script>
