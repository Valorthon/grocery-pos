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

    watch(
        isSheet,
        (on) => {
            if (!on) {
                removeModal(entry);
                return;
            }
            const active = document.activeElement;
            entry.opener =
                active instanceof HTMLElement && active !== document.body
                    ? active
                    : null;
            pushModal(entry);
            // The sheet itself, not a control: a stray Enter presses nothing.
            panel.value?.focus();
        },
        { flush: 'post' },
    );

    // Grown to lg: the panel is beside the ticket again.
    watch(isLarge, (large) => {
        if (large) hide();
    });

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
        /** True while the sheet is the topmost modal (not under a dialog). */
        isTop: () => isSheet.value && isTopmost(entry),
    };
}
