<template>
    <div
        role="group"
        :aria-label="label"
        data-segmented
        class="flex flex-wrap gap-px self-end rounded-control border border-line bg-line overflow-hidden"
    >
        <button
            v-for="option in options"
            :key="option.value"
            type="button"
            :aria-pressed="modelValue === option.value"
            :data-value="option.value"
            :class="[
                'focus-ring min-h-11 flex-1 px-3 text-sm font-semibold whitespace-nowrap',
                modelValue === option.value
                    ? 'bg-leaf-600 text-white'
                    : 'bg-surface text-ink hover:bg-paper',
            ]"
            @click="select(option.value)"
        >
            {{ option.label }}
        </button>
    </div>
</template>

<script setup lang="ts" generic="V extends string">
/** 44px toggle buttons, one pressed (#232, #242). Re-picking emits nothing.
 * Dividers are the bg-line showing through gap-px, so wrapped rows (#261) get
 * a line between rows and no stray left border. */
const props = defineProps<{
    modelValue: V;
    options: readonly { value: V; label: string }[];
    label: string;
}>();
const emit = defineEmits<{ (e: 'update:modelValue', value: V): void }>();
function select(value: V) {
    if (value !== props.modelValue) emit('update:modelValue', value);
}
</script>
