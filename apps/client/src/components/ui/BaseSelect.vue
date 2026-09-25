<template>
    <div>
        <label
            v-if="label"
            :for="id"
            class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5"
        >
            {{ label }}
        </label>

        <select
            :id="id"
            :value="selected"
            :disabled="disabled"
            :class="[
                'w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-slate-50 text-sm text-slate-900 focus:outline-none focus:border-primary-600 focus:bg-white cursor-pointer transition-all',
                disabled ? 'opacity-50 cursor-not-allowed' : '',
            ]"
            @change="onChange"
        >
            <option v-if="allLabel" :value="ALL">{{ allLabel }}</option>
            <option v-for="opt in options" :key="opt.value" :value="opt.value">
                {{ opt.label }}
            </option>
        </select>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
    defineProps<{
        modelValue?: string | number | null;
        id?: string;
        label?: string;
        disabled?: boolean;
        options: Array<{ label: string; value: string | number }>;
        /**
         * Opt-in "no filter" choice (issue #20): renders a first option
         * with this label that stands for `null`, so a filter can go back
         * to "all" and a `null` model shows it instead of the first option.
         */
        allLabel?: string;
    }>(),
    {
        modelValue: '',
        id: '',
        label: '',
        disabled: false,
        allLabel: '',
    },
);

const emit = defineEmits<{
    (e: 'update:modelValue', value: string | null): void;
}>();

/** The "All" option's DOM value; options with a value of '' can't use it. */
const ALL = '';

const selected = computed(() =>
    props.allLabel && props.modelValue == null ? ALL : props.modelValue,
);

function onChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    emit('update:modelValue', props.allLabel && value === ALL ? null : value);
}
</script>
