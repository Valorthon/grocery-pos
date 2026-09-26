import { onBeforeUnmount, onMounted, type Ref, shallowRef } from 'vue';

/** An element's horizontal centre and width, in viewport px. */
export interface ElementBox {
    center: number;
    width: number;
}

/**
 * Tracks where `el` sits across the viewport (#85: the register centres
 * its toasts on the ticket column, which moves when the sidebar collapses
 * or the window resizes). Null until measured, while the element is
 * missing or has no size (e.g. not laid out), and where ResizeObserver
 * does not exist.
 */
export function useElementBox(el: Ref<HTMLElement | null>) {
    const box = shallowRef<ElementBox | null>(null);
    let observer: ResizeObserver | null = null;

    function measure() {
        const rect = el.value?.getBoundingClientRect();
        const next =
            rect && rect.width > 0
                ? { center: rect.left + rect.width / 2, width: rect.width }
                : null;
        const prev = box.value;
        if (prev?.center === next?.center && prev?.width === next?.width) {
            return;
        }
        box.value = next;
    }

    onMounted(() => {
        if (typeof ResizeObserver === 'undefined' || !el.value) return;
        // The column resizes as the sidebar animates; its left edge moves
        // only with a resize of the column or the window.
        observer = new ResizeObserver(measure);
        observer.observe(el.value);
        window.addEventListener('resize', measure);
        measure();
    });

    onBeforeUnmount(() => {
        observer?.disconnect();
        observer = null;
        window.removeEventListener('resize', measure);
    });

    return box;
}
