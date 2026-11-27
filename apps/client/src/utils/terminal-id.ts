import { TERMINAL_ID_PATTERN } from '@grocery-pos/contracts';

/**
 * This browser's stable terminal id (#509). A shift is bound to the
 * browser that opened it: the API refuses sales, offline leases, drawer
 * movements and the cashier's own close from any other. One id per
 * browser profile, for every cashier, kept in localStorage; never the
 * editable terminal label, and never cleared on logout. If storage fails,
 * the id lasts for this page only (a reload then counts as another
 * terminal, so an ADMIN force-close may be needed).
 */
export const TERMINAL_ID_STORAGE_KEY = 'grocery_pos_terminal_v1';

let memo: string | undefined;

export function terminalId(): string {
    if (memo) return memo;
    try {
        const stored = localStorage.getItem(TERMINAL_ID_STORAGE_KEY);
        if (stored && TERMINAL_ID_PATTERN.test(stored)) return (memo = stored);
    } catch {
        // Storage unavailable: fall through to a page-lifetime id.
    }
    memo = crypto.randomUUID();
    try {
        localStorage.setItem(TERMINAL_ID_STORAGE_KEY, memo);
    } catch {
        // Kept in memory only.
    }
    return memo;
}

/** Test-only: forget the cached id. */
export function resetTerminalIdForTests(): void {
    memo = undefined;
}
