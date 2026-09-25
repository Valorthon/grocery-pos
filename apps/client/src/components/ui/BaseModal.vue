<template>
    <Teleport to="body">
        <Transition
            enter-active-class="transition duration-150 ease-out"
            enter-from-class="opacity-0"
            enter-to-class="opacity-100"
            leave-active-class="transition duration-150 ease-in"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0"
        >
            <div
                v-if="modelValue"
                ref="backdrop"
                class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm"
                @mousedown.self="dismiss"
            >
                <Transition
                    enter-active-class="transition duration-200 ease-out"
                    enter-from-class="opacity-0 scale-95"
                    enter-to-class="opacity-100 scale-100"
                    leave-active-class="transition duration-150 ease-in"
                    leave-from-class="opacity-100 scale-100"
                    leave-to-class="opacity-0 scale-95"
                >
                    <div
                        v-if="modelValue"
                        ref="panel"
                        role="dialog"
                        aria-modal="true"
                        :aria-labelledby="labelledBy()"
                        :aria-describedby="
                            subtitle && !$slots.header ? subtitleId : undefined
                        "
                        :aria-label="
                            labelledBy() ? undefined : ariaLabel || undefined
                        "
                        tabindex="-1"
                        :class="[
                            'bg-white rounded-2xl w-full shadow-2xl border border-slate-200 flex flex-col overflow-hidden focus:outline-none',
                            scrollable ? 'max-h-[92vh]' : '',
                        ]"
                        :style="{ maxWidth }"
                    >
                        <div
                            v-if="
                                title || subtitle || closable || $slots.header
                            "
                            class="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50"
                        >
                            <div v-if="$slots.header" :id="titleId">
                                <slot name="header" />
                            </div>
                            <div v-else>
                                <h2
                                    v-if="title"
                                    :id="titleId"
                                    class="text-base sm:text-lg font-extrabold text-slate-900"
                                >
                                    {{ title }}
                                </h2>
                                <p
                                    v-if="subtitle"
                                    :id="subtitleId"
                                    class="text-xs text-slate-500 mt-0.5"
                                >
                                    {{ subtitle }}
                                </p>
                            </div>
                            <button
                                v-if="closable"
                                type="button"
                                aria-label="Close"
                                data-modal-close
                                class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors shrink-0 focus-ring"
                                @click="dismiss"
                            >
                                <X :size="16" aria-hidden="true" />
                            </button>
                        </div>

                        <div
                            :class="[
                                'p-4 sm:p-5',
                                scrollable ? 'overflow-y-auto' : '',
                            ]"
                        >
                            <slot />
                        </div>

                        <div
                            v-if="$slots.footer"
                            class="px-4 sm:px-5 py-3.5 border-t border-slate-100 bg-slate-50 flex gap-2.5 items-center"
                        >
                            <slot name="footer" />
                        </div>
                    </div>
                </Transition>
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
import {
    nextTick,
    onBeforeUnmount,
    onMounted,
    useId,
    useSlots,
    useTemplateRef,
    watch,
} from 'vue';
import { X } from '@lucide/vue';
import {
    focusables,
    type ModalEntry,
    pushModal,
    removeModal,
} from './modal-stack';

/**
 * A dialog over the page (issues #19, #22): `role="dialog"`, labelled by
 * its title (or header slot) and described by its subtitle. While open, the
 * focus is trapped inside it, the rest of the page is inert, and only the
 * topmost modal answers Escape (see ./modal-stack.ts).
 *
 * - Initial focus: the first element marked `data-autofocus`, else the
 *   first focusable element (the header's close button last), else the
 *   dialog itself. `initialFocus="dialog"` always focuses the dialog, so
 *   a stray Enter presses nothing (the receipt); Tab still moves inside.
 * - On close, the focus goes back to what had it when the modal opened
 *   (see ./modal-stack.ts for when that is gone).
 * - `closable: false` (busy, e.g. a save in flight) hides the close button
 *   and makes Escape and the backdrop do nothing.
 */
const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        title?: string;
        subtitle?: string;
        maxWidth?: string;
        closable?: boolean;
        scrollable?: boolean;
        /** The accessible name when there is no title or header slot. */
        ariaLabel?: string;
        /** `dialog`: focus the dialog itself on open, not a control. */
        initialFocus?: 'auto' | 'dialog';
    }>(),
    {
        title: '',
        subtitle: '',
        maxWidth: '32rem',
        closable: true,
        scrollable: false,
        ariaLabel: '',
        initialFocus: 'auto',
    },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const slots = useSlots();
const backdrop = useTemplateRef<HTMLElement>('backdrop');
const panel = useTemplateRef<HTMLElement>('panel');
const titleId = useId();
const subtitleId = useId();

/** A function, not a computed: slots are not reactive. */
function labelledBy(): string | undefined {
    return slots.header || props.title ? titleId : undefined;
}

function close() {
    emit('update:modelValue', false);
}

/** Escape, the backdrop and the close button: ignored while busy. */
function dismiss() {
    if (props.closable) close();
}

const entry: ModalEntry = {
    root: () => backdrop.value,
    panel: () => panel.value,
    closable: () => props.closable,
    close,
    opener: null,
};

function firstFocusTarget(el: HTMLElement): HTMLElement {
    const items = focusables(el);
    return (
        items.find((i) => i.hasAttribute('data-autofocus')) ??
        items.find((i) => !i.hasAttribute('data-modal-close')) ??
        items[0] ??
        el
    );
}

async function open() {
    const active = document.activeElement;
    entry.opener =
        active instanceof HTMLElement && active !== document.body
            ? active
            : null;
    pushModal(entry);
    await nextTick();
    const el = panel.value;
    // A child may already have taken the focus while rendering.
    if (!el || !props.modelValue || el.contains(document.activeElement)) {
        return;
    }
    (props.initialFocus === 'dialog' ? el : firstFocusTarget(el)).focus();
}

watch(
    () => props.modelValue,
    (isOpen) => {
        if (isOpen) void open();
        else removeModal(entry);
    },
    { flush: 'post' },
);

onMounted(() => {
    if (props.modelValue) void open();
});

onBeforeUnmount(() => removeModal(entry));
</script>
