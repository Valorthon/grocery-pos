import { getCurrentInstance, onBeforeUnmount, type Ref, ref } from 'vue';

/** Tailwind's `lg` breakpoint (64rem): the register's side-by-side layout. */
export const LG_QUERY = '(min-width: 64rem)';

/**
 * Whether `query` matches now, kept up to date while the calling
 * component is mounted. Where `matchMedia` is missing (jsdom, very old
 * browsers) it is `fallback`.
 */
export function useMediaQuery(query: string, fallback: boolean): Ref<boolean> {
    const list =
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia(query)
            : null;
    const matches = ref(list ? list.matches : fallback);
    if (!list) return matches;

    const onChange = (event: MediaQueryListEvent) => {
        matches.value = event.matches;
    };
    list.addEventListener('change', onChange);
    if (getCurrentInstance()) {
        onBeforeUnmount(() => list.removeEventListener('change', onChange));
    }
    return matches;
}

/**
 * True at `lg` and up (issue #26). Without `matchMedia` it is true: the
 * wide layout is the one every control is visible in.
 */
export function useIsLarge(): Ref<boolean> {
    return useMediaQuery(LG_QUERY, true);
}
