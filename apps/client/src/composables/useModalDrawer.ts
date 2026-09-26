import { nextTick, onBeforeUnmount, type Ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
    anyModalOpen,
    focusPage,
    focusables,
    type ModalEntry,
    pushModal,
    removeModal,
} from '@/components/ui/modal-stack';

export interface ModalDrawerOptions {
    /** Whether the drawer is open now (false while it is a static rail). */
    open: Readonly<Ref<boolean>>;
    /** Closes it: Escape, any navigation, the caller's breakpoint. */
    close: () => void;
    /** Its element directly under `<body>` (the teleported wrapper). */
    root: () => HTMLElement | null;
    /** The drawer panel: the focus stays inside it while it is open. */
    panel: () => HTMLElement | null;
    /**
     * The drawer's element id. The button with `aria-controls` set to it is
     * the focus target on close when nothing was focused on opening (a
     * click on a button does not focus it in every browser).
     */
    id: string;
}

/**
 * A navigation drawer as an entry on the shared modal stack (#26, #89):
 * while open, the page behind it is inert, Escape closes it, Tab stays in
 * it and closing gives the focus back to its menu button. Any navigation
 * closes it, and nothing is left on the stack when the component unmounts.
 * The caller closes it when the window grows past its breakpoint.
 */
export function useModalDrawer(options: ModalDrawerOptions): void {
    const route = useRoute();

    const entry: ModalEntry = {
        root: options.root,
        panel: options.panel,
        closable: () => true,
        close: options.close,
        opener: null,
    };

    /** Pushed and not yet removed (a close's removal may still be due). */
    let onStack = false;

    function menuButton(): HTMLElement | null {
        return document.querySelector<HTMLElement>(
            `[aria-controls="${options.id}"]`,
        );
    }

    watch(
        options.open,
        (open) => {
            if (!open) {
                onStack = false;
                removeModal(entry);
                return;
            }
            const active = document.activeElement;
            entry.opener =
                active instanceof HTMLElement && active !== document.body
                    ? active
                    : menuButton();
            pushModal(entry);
            onStack = true;
            const nav = options.panel()?.querySelector<HTMLElement>('nav');
            // The focus moves to the drawer's first link.
            if (nav) focusables(nav)[0]?.focus();
        },
        { flush: 'post' },
    );

    watch(() => route.fullPath, options.close);

    // Unmounted while open (e.g. the browser's Back button swapped the
    // layout): the menu button usually goes with it, so the focus must not
    // be handed to it now and then lost to <body> as it is removed. The
    // stack is cleaned up at once; once the DOM has settled, the focus goes
    // to the menu button if it survived, else to the page's <main>.
    onBeforeUnmount(() => {
        if (!onStack) return;
        onStack = false;
        const opener = entry.opener;
        entry.opener = null;
        removeModal(entry);
        void nextTick(() => {
            const active = document.activeElement;
            // Another modal on top owns the focus.
            if (anyModalOpen.value) return;
            if (
                active &&
                active !== document.body &&
                active.isConnected &&
                !active.closest('[inert]')
            ) {
                return;
            }
            if (opener?.isConnected && !opener.closest('[inert]')) {
                opener.focus({ preventScroll: true });
            } else {
                focusPage();
            }
        });
    });
}
