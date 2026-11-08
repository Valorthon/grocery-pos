<template>
    <div :class="attrs.class" :style="attrs.style">
        <label v-if="label" :for="fieldId" :class="FIELD_LABEL">
            {{ label }}
        </label>

        <div class="relative">
            <span
                v-if="icon"
                :class="[
                    'absolute left-3.5 top-1/2 -translate-y-1/2',
                    FIELD_ICON,
                ]"
            >
                <slot name="icon" />
            </span>

            <input
                :id="fieldId"
                v-bind="inputAttrs()"
                :type="type"
                :maxlength="maxlength"
                :value="modelValue"
                :placeholder="placeholder"
                :disabled="disabled"
                :class="inputClasses"
                @input="onInput"
                @keydown.enter="
                    emit('enter', ($event.target as HTMLInputElement).value)
                "
                @blur="emit('blur')"
            />

            <button
                v-if="clearable && modelValue"
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-ink rounded focus-ring"
                @click="onClear"
            >
                <X :size="16" />
            </button>
        </div>

        <p v-if="error" :class="FIELD_ERROR_TEXT">{{ error }}</p>
    </div>
</template>

<script setup lang="ts">
import {
    FIELD_BASE,
    FIELD_DISABLED,
    FIELD_ERROR,
    FIELD_ERROR_TEXT,
    FIELD_ICON,
    FIELD_LABEL,
    FIELD_OK,
} from './field-style';
import { computed, useAttrs, useId } from 'vue';
import { X } from '@lucide/vue';

/*
 * Attributes the caller sets (min, step, inputmode, name, autocomplete,
 * listeners...) belong on the <input>, not on the wrapper div; class and
 * style stay on the wrapper so a grid cell class like `md:col-span-3`
 * still lays out the whole field (issue #17).
 */
defineOptions({ inheritAttrs: false });

const attrs = useAttrs();
// A function, not a computed: attrs are not reactive, but a change to them
// re-renders the component, which calls this again.
function inputAttrs() {
    return Object.fromEntries(
        Object.entries(attrs).filter(
            ([key]) => key !== 'class' && key !== 'style',
        ),
    );
}

const props = withDefaults(
    defineProps<{
        modelValue?: string | number | null;
        id?: string;
        label?: string;
        type?: string;
        /** Longest value the input accepts, e.g. a contracts STRING_LIMITS. */
        maxlength?: number;
        placeholder?: string;
        disabled?: boolean;
        clearable?: boolean;
        error?: string;
        icon?: boolean;
        mono?: boolean;
    }>(),
    {
        modelValue: '',
        id: '',
        label: '',
        type: 'text',
        maxlength: undefined,
        placeholder: '',
        disabled: false,
        clearable: false,
        error: '',
        icon: false,
        mono: false,
    },
);

/*
 * Without an explicit id the label still names the field (#142): a
 * generated id ties <label for> to the control.
 */
const autoId = useId();
const fieldId = computed(() => props.id || autoId);

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void;
    (e: 'enter', value: string): void;
    (e: 'clear'): void;
    (e: 'blur'): void;
}>();

const inputClasses = computed(() => [
    FIELD_BASE,
    props.icon ? 'pl-10 pr-3' : 'px-3.5',
    props.mono ? 'font-mono font-bold' : '',
    props.error ? FIELD_ERROR : FIELD_OK,
    props.disabled ? FIELD_DISABLED : '',
]);

function onInput(event: Event) {
    emit('update:modelValue', (event.target as HTMLInputElement).value);
}

function onClear() {
    emit('update:modelValue', '');
    emit('clear');
}
</script>
