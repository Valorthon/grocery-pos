import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue';
import { anyModalOpen } from '@/components/ui/modal-stack';
import { isTextEntry } from './useRegisterShortcuts';

/**
 * Whether the focus may be taken from `el` (issue #22): from anything but
 * a field the user is typing in (a text input, textarea or contenteditable),
 * a select, or an open menu. So from nowhere (`<body>`), a button, a link,
 * or a landmark the focus was parked on (`<main>` after a modal closed).
 */
export function canTakeFocusFrom(el: Element | null): boolean {
    if (!el || el === document.body || el === document.documentElement) {
        return true;
    }
    if (isTextEntry(el) || el instanceof HTMLSelectElement) return false;
    return !el.closest('[role="menu"]');
}

/**
 * Keeps the focus on `target` (the register's scan box) between actions,
 * so a scanner's keystrokes always land there (issue #22):
 *
 * - after a click on the page (`onPageClick` on its root): a ticket
 *   button, an empty spot, a match;
 * - after the last modal closes (a receipt, the checkout, a shift modal);
 * - when a printable key is typed while a button (or nothing) has the
 *   focus: the focus moves before the character is typed, so it goes into
 *   the box. Space is left alone (it presses the button).
 *
 * In every case the focus only moves when `canTakeFocusFrom` allows it,
 * so a discount reason or a quantity being typed is never interrupted,
 * and never while a modal is open.
 */
export function useStickyFocus(
    target: () => HTMLElement | null | undefined,
    options: {
        /**
         * Elements a click may leave the focus on, e.g. a ticket line the
         * cashier picked so Delete can remove it (#23). Typing a printable
         * key there still goes to the scan box.
         */
        keepOnClick?: (el: Element) => boolean;
        /**
         * An element that keeps the focus it has, e.g. the tender panel
         * control the focus was put back on after the window crossed lg
         * (#26).
         */
        holdsFocus?: (el: Element | null) => boolean;
    } = {},
) {
    function refocus() {
        const el = target();
        if (!el || anyModalOpen.value) return;
        if (el instanceof HTMLInputElement && el.disabled) return;
        if (!canTakeFocusFrom(document.activeElement)) return;
        if (options.holdsFocus?.(document.activeElement)) return;
        el.focus({ preventScroll: true });
    }

    /** Bind to the page root's `@click`: runs after the click's own work. */
    function onPageClick() {
        void nextTick(() => {
            const active = document.activeElement;
            if (active && options.keepOnClick?.(active)) return;
            refocus();
        });
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.defaultPrevented || anyModalOpen.value) return;
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        if (event.key.length !== 1 || event.key === ' ') return;
        refocus();
    }

    watch(
        anyModalOpen,
        (open) => {
            if (!open) void nextTick(refocus);
        },
        { flush: 'post' },
    );

    onMounted(() => document.addEventListener('keydown', onKeydown));
    onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));

    return { refocus, onPageClick };
}
