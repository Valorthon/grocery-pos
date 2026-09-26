import { type Ref, ref, watch } from 'vue';

/**
 * The seller sidebar's collapsed/expanded choice (product decision
 * 2026-09-25, #26): remembered per user on this device, like the basket
 * (`grocery_pos_cart_v1:<userId>`). It is the only preference the client
 * keeps in localStorage. Bump the version if the stored shape changes.
 */
export const SIDEBAR_STORAGE_PREFIX = 'grocery_pos_sidebar_v1:';

export function sidebarStorageKey(userId: string): string {
    return `${SIDEBAR_STORAGE_PREFIX}${userId}`;
}

const COLLAPSED = 'collapsed';
const EXPANDED = 'expanded';

/** The stored choice; expanded when there is none, or storage fails. */
export function readSidebarCollapsed(userId: string | undefined): boolean {
    if (!userId) return false;
    try {
        return localStorage.getItem(sidebarStorageKey(userId)) === COLLAPSED;
    } catch {
        return false;
    }
}

export function writeSidebarCollapsed(
    userId: string | undefined,
    collapsed: boolean,
): void {
    if (!userId) return;
    try {
        localStorage.setItem(
            sidebarStorageKey(userId),
            collapsed ? COLLAPSED : EXPANDED,
        );
    } catch {
        // Storage full or blocked: the choice holds until the page reloads.
    }
}

/**
 * `collapsed` starts expanded unless this user collapsed it before, and
 * follows the logged-in user. Changing it saves it for that user.
 */
export function useSidebarPreference(userId: () => string | undefined): {
    collapsed: Ref<boolean>;
    toggle: () => void;
} {
    const collapsed = ref(readSidebarCollapsed(userId()));

    watch(userId, (id) => {
        collapsed.value = readSidebarCollapsed(id);
    });

    function toggle() {
        collapsed.value = !collapsed.value;
        writeSidebarCollapsed(userId(), collapsed.value);
    }

    return { collapsed, toggle };
}
