<template>
    <div class="relative">
        <label
            v-if="label"
            :for="id"
            class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5"
        >
            {{ label }}
        </label>

        <div class="relative">
            <span
                v-if="icon"
                class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            >
                <slot name="icon" />
            </span>

            <input
                :id="id"
                :value="modelValue"
                :placeholder="placeholder"
                :disabled="disabled"
                :class="[
                    'w-full py-2.5 rounded-xl border text-sm bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600/10 transition-all',
                    icon ? 'pl-10 pr-10' : 'px-3.5',
                    error
                        ? 'border-red-500 bg-red-50'
                        : 'border-slate-300 bg-slate-50 focus:bg-white',
                ]"
                @input="onInput"
                @keydown.down.prevent="moveSelection(1)"
                @keydown.up.prevent="moveSelection(-1)"
                @keydown.enter.prevent="selectHighlighted"
                @keydown.esc="close"
                @blur="onBlur"
            />

            <Spinner
                v-if="loading"
                size="sm"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
        </div>

        <p v-if="error" class="text-xs text-red-600 mt-1">{{ error }}</p>

        <ul
            v-if="isOpen && options.length"
            class="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg"
        >
            <li
                v-for="(opt, index) in options"
                :key="opt.value"
                class="cursor-pointer px-3.5 py-2.5 text-sm hover:bg-slate-50"
                :class="index === highlighted ? 'bg-slate-100' : ''"
                @mousedown.prevent="select(opt)"
            >
                <div class="font-bold text-slate-900">{{ opt.label }}</div>
                <div v-if="opt.subtitle" class="text-xs text-slate-500">
                    {{ opt.subtitle }}
                </div>
            </li>
        </ul>

        <div
            v-else-if="isOpen && !loading && modelValue"
            class="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-lg"
        >
            No matching products.
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import Spinner from './Spinner.vue';

export interface ComboboxOption {
    value: string;
    label: string;
    subtitle?: string;
}

const props = withDefaults(
    defineProps<{
        modelValue?: string | null;
        id?: string;
        label?: string;
        placeholder?: string;
        disabled?: boolean;
        loading?: boolean;
        error?: string;
        icon?: boolean;
        options: ComboboxOption[];
    }>(),
    {
        modelValue: '',
        id: '',
        label: '',
        placeholder: '',
        disabled: false,
        loading: false,
        error: '',
        icon: false,
    },
);

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void;
    (e: 'search', value: string): void;
    (e: 'select', value: ComboboxOption): void;
}>();

const isOpen = ref(false);
const highlighted = ref(0);

function onInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    emit('update:modelValue', value);
    emit('search', value);
    isOpen.value = true;
    highlighted.value = 0;
}

function select(opt: ComboboxOption) {
    emit('select', opt);
    isOpen.value = false;
}

function moveSelection(delta: number) {
    if (!props.options.length) return;
    highlighted.value =
        (highlighted.value + delta + props.options.length) %
        props.options.length;
}

function selectHighlighted() {
    const opt = props.options[highlighted.value];
    if (opt) select(opt);
}

function close() {
    isOpen.value = false;
}

function onBlur() {
    setTimeout(() => {
        isOpen.value = false;
    }, 150);
}
</script>
