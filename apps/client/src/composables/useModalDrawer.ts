import { onBeforeUnmount, type Ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
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

    function menuButton(): HTMLElement | null {
        return document.querySelector<HTMLElement>(
            `[aria-controls="${options.id}"]`,
        );
    }

    watch(
        options.open,
        (open) => {
            if (!open) {
                removeModal(entry);
                return;
            }
            const active = document.activeElement;
            entry.opener =
                active instanceof HTMLElement && active !== document.body
                    ? active
                    : menuButton();
            pushModal(entry);
            const nav = options.panel()?.querySelector<HTMLElement>('nav');
            // The focus moves to the drawer's first link.
            if (nav) focusables(nav)[0]?.focus();
        },
        { flush: 'post' },
    );

    watch(() => route.fullPath, options.close);

    onBeforeUnmount(() => removeModal(entry));
}
