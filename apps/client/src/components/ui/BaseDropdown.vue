<template>
    <div
        ref="rootRef"
        class="relative"
        @keydown="onKeydown"
        @focusout="onFocusOut"
    >
        <!--
            Bind `trigger` onto the slot's own <button> (v-bind="trigger"): it
            carries the click handler and the menu-button ARIA (issue #22).
        -->
        <slot
            name="trigger"
            :open="modelValue"
            :toggle="toggle"
            :trigger="triggerAttrs"
        />

        <Transition
            enter-active-class="transition duration-100 ease-out"
            enter-from-class="opacity-0 scale-95"
            enter-to-class="opacity-100 scale-100"
            leave-active-class="transition duration-100 ease-in"
            leave-from-class="opacity-100 scale-100"
            leave-to-class="opacity-0 scale-95"
        >
            <div
                v-if="modelValue"
                :id="menuId"
                ref="menuRef"
                role="menu"
                :class="[
                    'absolute z-50 mt-2 rounded-2xl bg-white shadow-xl border border-slate-200 p-1.5',
                    align === 'right' ? 'right-0' : 'left-0',
                    widthClass,
                ]"
                @click="onMenuClick"
            >
                <slot name="menu" :close="close" />
            </div>
        </Transition>
    </div>
</template>

<script setup lang="ts">
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    useId,
} from 'vue';

/**
 * A menu button (issue #22). The trigger slot binds `trigger` onto its
 * button: `aria-haspopup`, `aria-expanded`, `aria-controls` and the click
 * that toggles the menu.
 *
 * - Opening from the keyboard (Enter, Space, ↓/↑ on the trigger) focuses
 *   the first (↑: last) menu item; ↓/↑/Home/End move between items.
 * - Escape closes the menu and gives the focus back to the trigger; it
 *   does not reach a modal around it.
 * - A click on an item (a button, link or `role="menuitem"`) closes it; a
 *   click elsewhere inside the panel does not. A click outside, or Tab
 *   out of it, closes it too.
 */
const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        align?: 'left' | 'right';
        widthClass?: string;
    }>(),
    {
        align: 'right',
        widthClass: 'w-56',
    },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const rootRef = ref<HTMLElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const menuId = useId();

const ITEM = '[role="menuitem"], button:not(:disabled), a[href]';

const triggerAttrs = computed(() => ({
    type: 'button' as const,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': props.modelValue,
    'aria-controls': props.modelValue ? menuId : undefined,
    'data-dropdown-trigger': '',
    onClick: toggle,
}));

function triggerEl(): HTMLElement | null {
    return (
        rootRef.value?.querySelector<HTMLElement>('[data-dropdown-trigger]') ??
        null
    );
}

function items(): HTMLElement[] {
    return menuRef.value
        ? [...menuRef.value.querySelectorAll<HTMLElement>(ITEM)]
        : [];
}

async function openAndFocus(which: 'first' | 'last') {
    emit('update:modelValue', true);
    await nextTick();
    const list = items();
    (which === 'first' ? list[0] : list[list.length - 1])?.focus();
}

/** `detail === 0`: a click made by Enter or Space, not by a pointer. */
function toggle(event?: MouseEvent) {
    if (props.modelValue) {
        close();
    } else if (event && event.detail === 0) {
        void openAndFocus('first');
    } else {
        emit('update:modelValue', true);
    }
}

function close() {
    emit('update:modelValue', false);
}

function closeToTrigger() {
    close();
    triggerEl()?.focus();
}

function move(delta: number) {
    const list = items();
    if (!list.length) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    const next =
        index === -1
            ? delta > 0
                ? 0
                : list.length - 1
            : (index + delta + list.length) % list.length;
    list[next].focus();
}

function onKeydown(event: KeyboardEvent) {
    const onTrigger = event.target === triggerEl();
    switch (event.key) {
        case 'Escape':
            if (!props.modelValue) return;
            event.preventDefault();
            event.stopPropagation();
            closeToTrigger();
            return;
        case 'ArrowDown':
        case 'ArrowUp': {
            event.preventDefault();
            const down = event.key === 'ArrowDown';
            if (onTrigger && !props.modelValue) {
                void openAndFocus(down ? 'first' : 'last');
            } else if (props.modelValue) {
                move(down ? 1 : -1);
            }
            return;
        }
        case 'Home':
        case 'End':
            if (!props.modelValue || onTrigger) return;
            event.preventDefault();
            items()[event.key === 'Home' ? 0 : items().length - 1]?.focus();
            return;
    }
}

function onMenuClick(event: MouseEvent) {
    const target = event.target;
    if (target instanceof Element && target.closest(ITEM)) close();
}

function onFocusOut(event: FocusEvent) {
    const next = event.relatedTarget;
    if (
        props.modelValue &&
        next instanceof Node &&
        !rootRef.value?.contains(next)
    ) {
        close();
    }
}

function onClickOutside(event: MouseEvent) {
    if (rootRef.value && !rootRef.value.contains(event.target as Node)) {
        emit('update:modelValue', false);
    }
}

onMounted(() => {
    document.addEventListener('mousedown', onClickOutside);
});

onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onClickOutside);
});
</script>
