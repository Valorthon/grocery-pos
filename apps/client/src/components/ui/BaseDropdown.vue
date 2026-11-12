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

        <Teleport to="body" :disabled="!floating">
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
                        'rounded-card bg-surface shadow-overlay border border-line p-1.5',
                        floating && inModal ? 'z-[60]' : 'z-50',
                        floating
                            ? 'fixed'
                            : [
                                  'absolute mt-2',
                                  align === 'right' ? 'right-0' : 'left-0',
                              ],
                        widthClass,
                    ]"
                    :style="floating ? floatingStyle : undefined"
                    :data-placement="floating ? placement : undefined"
                    :data-inert-exempt="floating && inModal ? '' : undefined"
                    @click="onMenuClick"
                    @keydown="floating ? onKeydown($event) : undefined"
                    @focusout="floating ? onFocusOut($event) : undefined"
                >
                    <slot name="menu" :close="close" />
                </div>
            </Transition>
        </Teleport>
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
    watch,
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
 * - `floating`: Tab in the teleported panel closes it and puts the focus
 *   on the trigger without preventing the key, so the focus moves on
 *   from it; Shift+Tab closes it onto the trigger. The panel is aligned to the
 *   trigger and kept 8px inside the viewport. Opened from inside an open
 *   modal (checked at open), it is exempt from the modal stack's inert
 *   background and focus trap and stacks above the modal (#298).
 */
const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        align?: 'left' | 'right';
        widthClass?: string;
        /**
         * Teleport the panel to the body with fixed positioning, flipped
         * above the trigger when there is no room below (#172): for menus
         * inside a scrolling/clipping box such as a table. Needs a fixed
         * `widthClass` (e.g. `w-56`): the panel is placed and clamped from
         * its width. A scroll or resize that hides the trigger closes it.
         */
        floating?: boolean;
    }>(),
    {
        align: 'right',
        widthClass: 'w-56',
        floating: false,
    },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const rootRef = ref<HTMLElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const menuId = useId();

const ITEM = '[role="menuitem"], button:not(:disabled), a[href]';
/** What arrow keys and opening focus: never a disabled item (#172). */
const FOCUSABLE_ITEM = ':is([role="menuitem"], button, a[href]):not(:disabled)';

const placement = ref<'below' | 'above'>('below');
const floatingStyle = ref<Record<string, string>>({});
const GAP = 8;
/** The floating panel's least distance from the viewport's sides (#298). */
const MARGIN = 8;
/**
 * Checked when the menu opens: the trigger sits in an open modal (a drawer
 * below lg, #298). The teleported panel is then a sibling of that modal
 * under <body>, so it is exempt from the modal stack's inert background
 * and focus trap, and stacks above it (z-[60], as the toasts).
 */
const inModal = ref(false);

/**
 * On scroll/resize: closes the menu, without moving the focus, once the
 * trigger is gone (inert, hidden or entirely off-screen); else re-places it.
 */
function reposition() {
    const trigger = triggerEl();
    if (!trigger || !triggerVisible(trigger)) {
        close();
        return;
    }
    place();
}

function triggerVisible(trigger: HTMLElement): boolean {
    if (trigger.closest('[inert]')) return false;
    if (
        typeof trigger.checkVisibility === 'function' &&
        !trigger.checkVisibility()
    )
        return false;
    const box = trigger.getBoundingClientRect();
    return (
        box.bottom > 0 &&
        box.right > 0 &&
        box.top < window.innerHeight &&
        box.left < document.documentElement.clientWidth
    );
}

/** Places the floating panel from the trigger's box; flips up if needed. */
function place() {
    const trigger = triggerEl();
    const menu = menuRef.value;
    if (!trigger || !menu) return;
    const box = trigger.getBoundingClientRect();
    const height = menu.offsetHeight;
    const below = window.innerHeight - box.bottom;
    const up = below < height + GAP && box.top > below;
    placement.value = up ? 'above' : 'below';
    const style: Record<string, string> = up
        ? { bottom: `${window.innerHeight - box.top + GAP}px` }
        : { top: `${box.bottom + GAP}px` };
    // Aligned to the trigger's edge, then kept MARGIN inside the viewport.
    const width = menu.offsetWidth;
    const viewport = document.documentElement.clientWidth;
    const wanted = props.align === 'right' ? box.right - width : box.left;
    const left = Math.max(MARGIN, Math.min(wanted, viewport - width - MARGIN));
    style.left = `${left}px`;
    floatingStyle.value = style;
}

function contains(node: Node): boolean {
    return !!rootRef.value?.contains(node) || !!menuRef.value?.contains(node);
}

watch(
    () => props.modelValue,
    async (open) => {
        if (!props.floating) return;
        if (open) {
            inModal.value = !!triggerEl()?.closest('[aria-modal="true"]');
            await nextTick();
            place();
            window.addEventListener('scroll', reposition, true);
            window.addEventListener('resize', reposition);
        } else {
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener('resize', reposition);
        }
    },
);

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
        ? [...menuRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_ITEM)]
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
        case 'Tab':
            if (
                props.floating &&
                props.modelValue &&
                event.target instanceof Node &&
                !!menuRef.value?.contains(event.target)
            ) {
                close();
                // Shift+Tab lands on the trigger itself; Tab moves on from it.
                if (event.shiftKey) event.preventDefault();
                triggerEl()?.focus();
            }
            return;
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
    if (props.modelValue && next instanceof Node && !contains(next)) {
        close();
    }
}

function onClickOutside(event: MouseEvent) {
    if (rootRef.value && !contains(event.target as Node)) {
        emit('update:modelValue', false);
    }
}

onMounted(() => {
    document.addEventListener('mousedown', onClickOutside);
});

onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onClickOutside);
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
});
</script>
