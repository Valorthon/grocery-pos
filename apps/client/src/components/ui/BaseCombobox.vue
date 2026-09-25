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
                :maxlength="maxlength"
                autocomplete="off"
                role="combobox"
                aria-autocomplete="list"
                :aria-controls="listId"
                :aria-expanded="listShown"
                :aria-activedescendant="
                    listShown && options[highlighted]
                        ? optionId(highlighted)
                        : undefined
                "
                :class="[
                    'w-full py-2.5 rounded-xl border text-sm bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600/10 transition-all',
                    icon ? 'pl-10 pr-10' : 'px-3.5 pr-10',
                    error
                        ? 'border-red-500 bg-red-50'
                        : selected
                          ? 'border-emerald-500 bg-white'
                          : 'border-slate-300 bg-slate-50 focus:bg-white',
                ]"
                @input="onInput"
                @keydown.down.prevent="moveSelection(1)"
                @keydown.up.prevent="moveSelection(-1)"
                @keydown.enter.prevent="selectHighlighted"
                @keydown.esc="onEscape"
                @blur="close"
            />

            <Spinner
                v-if="loading"
                size="sm"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <CircleCheck
                v-else-if="selected"
                :size="16"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600"
            />
        </div>

        <p v-if="error" class="text-xs text-red-600 mt-1">{{ error }}</p>
        <p
            v-else-if="selected"
            data-testid="combobox-selected"
            class="mt-1 text-xs text-emerald-700"
        >
            Selected:
            <span class="font-bold">{{ selected.label }}</span>
            <span v-if="selected.subtitle"> · {{ selected.subtitle }}</span>
        </p>

        <ul
            v-if="listShown"
            :id="listId"
            ref="list"
            role="listbox"
            :aria-label="label || placeholder || undefined"
            class="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg"
        >
            <li
                v-for="(opt, index) in options"
                :id="optionId(index)"
                :key="opt.value"
                role="option"
                :aria-selected="index === highlighted"
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
            v-else-if="isOpen && !loading && !error && modelValue"
            class="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-lg"
        >
            No matching products.
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue';
import { CircleCheck } from '@lucide/vue';
import Spinner from './Spinner.vue';

export interface ComboboxOption {
    value: string;
    label: string;
    subtitle?: string;
    /** Text written back into the input when picked; defaults to `label`. */
    display?: string;
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
        maxlength?: number;
        options: ComboboxOption[];
        /**
         * The picked option (`v-model:selected`), shown as a confirmation
         * under the input. Typing after a pick clears it, so a stale pick
         * never stays attached to different text (issue #17).
         */
        selected?: ComboboxOption | null;
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
        maxlength: undefined,
        selected: null,
    },
);

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void;
    (e: 'search', value: string): void;
    (e: 'select', value: ComboboxOption): void;
    (e: 'update:selected', value: ComboboxOption | null): void;
}>();

const isOpen = ref(false);
const highlighted = ref(0);
const listShown = computed(() => isOpen.value && props.options.length > 0);
const listId = useId();
const optionId = (index: number) => `${listId}-${index}`;
const list = useTemplateRef<HTMLElement>('list');

// Keeps the highlighted option visible in a scrolled list (issue #22).
watch([highlighted, listShown], async () => {
    if (!listShown.value) return;
    await nextTick();
    list.value?.children[highlighted.value]?.scrollIntoView?.({
        block: 'nearest',
    });
});
/**
 * True from a keystroke until the parent answers with new options: until
 * then the list still holds the previous query's matches, so Enter must not
 * pick one of them.
 */
const awaitingOptions = ref(false);

watch(
    () => props.options,
    () => {
        awaitingOptions.value = false;
        highlighted.value = 0;
    },
);

function onInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    if (props.selected) emit('update:selected', null);
    emit('update:modelValue', value);
    emit('search', value);
    isOpen.value = true;
    highlighted.value = 0;
    awaitingOptions.value = true;
}

function select(opt: ComboboxOption) {
    emit('update:modelValue', opt.display ?? opt.label);
    emit('update:selected', opt);
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
    if (!isOpen.value || awaitingOptions.value || props.loading) return;
    const opt = props.options[highlighted.value];
    if (opt) select(opt);
}

/**
 * Closes the list. Options pick on `mousedown.prevent`, so clicking one
 * never blurs the input first: no delay is needed here (issue #22).
 */
function close() {
    isOpen.value = false;
}

/** Escape closes an open list, and only the list, not a modal around it. */
function onEscape(event: KeyboardEvent) {
    if (!listShown.value) return;
    event.stopPropagation();
    close();
}
</script>
