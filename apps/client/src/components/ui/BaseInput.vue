<template>
    <div>
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
                :type="type"
                :min="min"
                :step="step"
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
                class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded"
                @click="onClear"
            >
                <X :size="16" />
            </button>
        </div>

        <p v-if="error" class="text-xs text-red-600 mt-1">{{ error }}</p>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { X } from '@lucide/vue';

const props = withDefaults(
    defineProps<{
        modelValue?: string | number | null;
        id?: string;
        label?: string;
        type?: string;
        min?: string | number;
        step?: string | number;
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
        min: undefined,
        step: undefined,
        maxlength: undefined,
        placeholder: '',
        disabled: false,
        clearable: false,
        error: '',
        icon: false,
        mono: false,
    },
);

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void;
    (e: 'enter', value: string): void;
    (e: 'clear'): void;
    (e: 'blur'): void;
}>();

const inputClasses = computed(() => [
    'w-full py-2.5 rounded-xl border text-sm bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600/10 transition-all',
    props.icon ? 'pl-10 pr-3' : 'px-3.5',
    props.mono ? 'font-mono font-bold' : '',
    props.error
        ? 'border-red-500 bg-red-50'
        : 'border-slate-300 bg-slate-50 focus:bg-white',
]);

function onInput(event: Event) {
    emit('update:modelValue', (event.target as HTMLInputElement).value);
}

function onClear() {
    emit('update:modelValue', '');
    emit('clear');
}
</script>
