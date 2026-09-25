import { computed, nextTick, onBeforeUnmount, type Ref, ref, watch } from 'vue';
import {
    isTopmost,
    type ModalEntry,
    pushModal,
    removeModal,
} from '@/components/ui/modal-stack';

/**
 * The register's tender panel below `lg` (product decision 2026-09-25,
 * #26): a sticky footer shows the total and opens the panel as a sheet
 * over the ticket. At `lg` and up the panel sits beside the ticket and
 * this does nothing.
 *
 * The sheet is an entry on the shared modal stack, like a BaseModal: only
 * it answers Escape while on top, the focus is trapped in it, the page
 * behind is inert, and closing it gives the focus back to its opener. Its
 * `root` must be a direct child of `<body>` (the caller teleports it
 * there); `panel` is the dialog inside it.
 */
export function useTenderSheet(
    isLarge: Readonly<Ref<boolean>>,
    root: Readonly<Ref<HTMLElement | null>>,
    panel: Readonly<Ref<HTMLElement | null>>,
) {
    const open = ref(false);
    /** True while the panel is shown as a sheet (below lg, opened). */
    const isSheet = computed(() => !isLarge.value && open.value);

    function hide() {
        open.value = false;
    }

    const entry: ModalEntry = {
        root: () => root.value,
        panel: () => panel.value,
        closable: () => true,
        close: hide,
        opener: null,
    };

    /**
     * The control that had the focus in the panel when the window crossed
     * lg: moving the panel (the teleport) drops the focus, so it is put
     * back once the panel is in its new place.
     */
    let restoreTo: HTMLElement | null = null;
    /** Restored after a crossing; the scan box must not take it (#26). */
    let pinned: HTMLElement | null = null;

    function restoreFocus() {
        const el = restoreTo;
        restoreTo = null;
        if (!el?.isConnected) return false;
        el.focus({ preventScroll: true });
        if (document.activeElement !== el) return false;
        // Only until the cashier does something: a key (a scan still goes
        // to the scan box), a tap, or the focus moving on.
        pinned = el;
        const unpin = () => {
            if (pinned === el) pinned = null;
            el.removeEventListener('focusout', unpin);
            document.removeEventListener('keydown', unpin, true);
            document.removeEventListener('pointerdown', unpin, true);
        };
        el.addEventListener('focusout', unpin);
        document.addEventListener('keydown', unpin, true);
        document.addEventListener('pointerdown', unpin, true);
        return true;
    }

    watch(
        isSheet,
        (on) => {
            if (!on) {
                removeModal(entry);
                restoreFocus();
                return;
            }
            const active = document.activeElement;
            entry.opener =
                active instanceof HTMLElement && active !== document.body
                    ? active
                    : null;
            pushModal(entry);
            // Else the sheet itself, not a control: a stray Enter presses
            // nothing.
            if (!restoreFocus()) panel.value?.focus();
        },
        { flush: 'post' },
    );

    /**
     * Crossing lg, before the panel moves: with the focus in the panel,
     * shrinking opens the sheet (so the focused field stays visible) and
     * growing closes it without sending the focus back to its opener;
     * either way the focus goes back to the same control. Grown to lg,
     * the panel is beside the ticket again.
     */
    watch(
        isLarge,
        (large) => {
            const active = document.activeElement;
            const el = panel.value;
            restoreTo =
                el &&
                active instanceof HTMLElement &&
                active !== el &&
                el.contains(active)
                    ? active
                    : null;
            if (large) {
                if (!open.value) restoreTo = null;
                if (restoreTo) entry.opener = null;
                hide();
            } else if (restoreTo) {
                open.value = true;
            }
        },
        { flush: 'pre' },
    );

    onBeforeUnmount(() => removeModal(entry));

    /**
     * Opens the sheet below lg and resolves once it is on screen and on
     * the modal stack. At lg the panel is always shown: nothing to do.
     */
    async function show(): Promise<void> {
        if (isLarge.value) return;
        open.value = true;
        await nextTick();
    }

    return {
        open,
        isSheet,
        show,
        hide,
        /**
         * True for the control the focus was put back on after crossing
         * lg, until it loses the focus: the register's sticky scan box
         * must leave it there.
         */
        holdsFocus: (el: Element | null) => !!el && el === pinned,
        /** True while the sheet is the topmost modal (not under a dialog). */
        isTop: () => isSheet.value && isTopmost(entry),
    };
}
