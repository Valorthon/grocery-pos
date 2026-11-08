<template>
    <label class="inline-flex items-center gap-2 cursor-pointer select-none">
        <input
            type="checkbox"
            :checked="modelValue"
            :disabled="disabled"
            :class="CHECKBOX_INPUT"
            @change="
                emit(
                    'update:modelValue',
                    ($event.target as HTMLInputElement).checked,
                )
            "
        />
        <span v-if="label" :class="CHECKBOX_LABEL">{{ label }}</span>
    </label>
</template>

<script setup lang="ts">
import { CHECKBOX_INPUT, CHECKBOX_LABEL } from './field-style';
withDefaults(
    defineProps<{
        modelValue?: boolean;
        label?: string;
        disabled?: boolean;
    }>(),
    {
        modelValue: false,
        label: '',
        disabled: false,
    },
);

const emit = defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
}>();
</script>
