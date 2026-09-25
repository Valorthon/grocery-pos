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
                class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm"
                @mousedown.self="close"
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
                        :class="[
                            'bg-white rounded-2xl w-full shadow-2xl border border-slate-200 flex flex-col overflow-hidden',
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
                            <slot name="header">
                                <div>
                                    <h2
                                        v-if="title"
                                        class="text-base sm:text-lg font-extrabold text-slate-900"
                                    >
                                        {{ title }}
                                    </h2>
                                    <p
                                        v-if="subtitle"
                                        class="text-xs text-slate-500 mt-0.5"
                                    >
                                        {{ subtitle }}
                                    </p>
                                </div>
                            </slot>
                            <button
                                v-if="closable"
                                type="button"
                                class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors shrink-0"
                                @click="close"
                            >
                                <X :size="16" />
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

<script lang="ts">
/**
 * Open modals, newest last, shared by every BaseModal (issue #19: a
 * confirmation can open on top of a save dialog). Only the topmost one
 * answers Escape, and the page stays scroll-locked until the last one
 * closes. Full dialog semantics (focus trap, roles) are #22.
 */
const openModals: symbol[] = [];

function lockScroll(modal: symbol): void {
    if (!openModals.includes(modal)) openModals.push(modal);
    document.body.style.overflow = 'hidden';
}

function unlockScroll(modal: symbol): void {
    const index = openModals.indexOf(modal);
    if (index > -1) openModals.splice(index, 1);
    if (openModals.length === 0) document.body.style.overflow = '';
}

function isTopmost(modal: symbol): boolean {
    return openModals[openModals.length - 1] === modal;
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { X } from '@lucide/vue';

const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        title?: string;
        subtitle?: string;
        maxWidth?: string;
        closable?: boolean;
        scrollable?: boolean;
    }>(),
    {
        title: '',
        subtitle: '',
        maxWidth: '32rem',
        closable: true,
        scrollable: false,
    },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const self = Symbol('BaseModal');

function close() {
    emit('update:modelValue', false);
}

function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && props.modelValue && isTopmost(self)) close();
}

watch(
    () => props.modelValue,
    (open) => {
        if (open) {
            document.addEventListener('keydown', onKeydown);
            lockScroll(self);
        } else {
            document.removeEventListener('keydown', onKeydown);
            unlockScroll(self);
        }
    },
);

onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown);
    unlockScroll(self);
});
</script>
