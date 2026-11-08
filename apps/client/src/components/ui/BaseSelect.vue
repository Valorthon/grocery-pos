<template>
    <div>
        <label v-if="label" :for="fieldId" :class="FIELD_LABEL">
            {{ label }}
        </label>

        <select
            :id="fieldId"
            :aria-label="label ? undefined : ariaLabel || undefined"
            :value="selected"
            :disabled="disabled"
            :class="[
                FIELD_BASE,
                FIELD_OK,
                'px-3.5 cursor-pointer',
                disabled ? FIELD_DISABLED : '',
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
import {
    FIELD_BASE,
    FIELD_DISABLED,
    FIELD_LABEL,
    FIELD_OK,
} from './field-style';
import { computed, useId } from 'vue';

const props = withDefaults(
    defineProps<{
        modelValue?: string | number | null;
        id?: string;
        label?: string;
        /** Accessible name for a select shown without a visible label. */
        ariaLabel?: string;
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
        ariaLabel: '',
        disabled: false,
        allLabel: '',
    },
);

/*
 * Without an explicit id the label still names the field (#142): a
 * generated id ties <label for> to the control.
 */
const autoId = useId();
const fieldId = computed(() => props.id || autoId);

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
