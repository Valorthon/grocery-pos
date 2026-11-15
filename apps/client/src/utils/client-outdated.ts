import { ref } from 'vue';
import { ErrorCode } from '@grocery-pos/contracts';
import { apiErrorCode } from './api-error';

/**
 * Set once the single-pc API refuses this tab's build (409
 * CLIENT_OUTDATED, #364): Grocery POS was upgraded while the page was
 * open. `ClientOutdatedDialog` then asks for a reload. Nothing is cleared:
 * the basket (localStorage) and queued offline cash (IndexedDB) survive
 * the reload, and the outbox keeps such a refused upload queued.
 */
export const clientOutdated = ref(false);

/** Marks the tab outdated when `error` is that refusal; returns whether it was. */
export function noteClientOutdated(error: unknown): boolean {
    if (apiErrorCode(error) !== ErrorCode.CLIENT_OUTDATED) return false;
    clientOutdated.value = true;
    return true;
}

/** The dialog's Reload button (a seam for tests). */
export const reloader = {
    reload: () => window.location.reload(),
};
