<template>
    <label class="inline-flex items-center gap-2 cursor-pointer select-none">
        <input
            type="checkbox"
            :checked="modelValue"
            :disabled="disabled"
            class="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 accent-primary-600"
            @change="
                emit(
                    'update:modelValue',
                    ($event.target as HTMLInputElement).checked,
                )
            "
        />
        <span v-if="label" class="text-sm text-slate-700">{{ label }}</span>
    </label>
</template>

<script setup lang="ts">
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
