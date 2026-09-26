import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { Color, useUIStore } from '@/stores/ui';
import type { ConfirmRequest } from './useConfirm';

/** A draft row with its page-local id (issue #19). Never sent to the API. */
export type WithDraftId<T> = T & { draftId: string };

let lastDraftId = 0;

/**
 * A fresh row id. A counter, not `crypto.randomUUID()`: that exists only
 * in secure contexts (not a plain-http LAN register), and the id only has
 * to be unique within one page load.
 */
export function newDraftId(): string {
    lastDraftId += 1;
    return `draft-${lastDraftId}`;
}

/**
 * The rows of a draft page, each keyed by a `draftId` given when it is
 * added and kept through edits (issue #19). Nothing on a row, not the EAN
 * (blank when auto-generated) nor the product (two lines may share one),
 * is unique, so rows are found and keyed by this id alone.
 */
export function useDraftList<T extends object>() {
    const items = ref([]) as Ref<WithDraftId<T>[]>;

    function add(value: T): WithDraftId<T> {
        const draft = { ...value, draftId: newDraftId() };
        items.value.push(draft);
        return draft;
    }

    /** Replaces the row's fields, keeping its id. */
    function replace(draftId: string, value: T): void {
        const index = items.value.findIndex((d) => d.draftId === draftId);
        if (index > -1) items.value[index] = { ...value, draftId };
    }

    function remove(draftId: string): void {
        const index = items.value.findIndex((d) => d.draftId === draftId);
        if (index > -1) items.value.splice(index, 1);
    }

    function clear(): void {
        items.value = [];
    }

    return { items, add, replace, remove, clear };
}

/** "1 unsaved draft", "3 unsaved drafts". */
export function unsavedDrafts(count: number): string {
    return `${count} unsaved draft${count === 1 ? '' : 's'}`;
}

/** What a draft page tells its guard. */
export interface DraftGuardOptions {
    /** How many unsaved rows the page holds. */
    count: () => number;
    /** True while the page's save request is in flight. */
    saving: () => boolean;
    /** The page's `useConfirm().confirm`. */
    confirm: (request: ConfirmRequest) => Promise<boolean>;
}

/**
 * Guards a draft page's unsaved rows (issue #19) while it has any:
 *
 * - leaving for another page asks first (in-app, through `confirm`), and
 *   so does Log out (`requestLogout` navigates to Login before it ends
 *   the session): "Stay" keeps the drafts and the session;
 * - while a save is in flight nobody leaves, and nobody is asked: the
 *   save's own outcome decides (it goes to the list, or reports the error
 *   here with the drafts kept);
 * - closing or reloading the tab gets the browser's own prompt
 *   (`beforeunload`), registered only while there are drafts and always
 *   removed on unmount.
 *
 * A page empties its list once the drafts are saved or cleared, so its
 * own navigation after a save is never stopped. A forced end of the
 * session is never stopped either: the refresh that failed and the
 * router's "no session" redirect both leave the user signed out before
 * they navigate, the server session is already gone, and the drafts
 * could not be saved anyway.
 */
export function useUnsavedDraftsGuard({
    count,
    saving,
    confirm,
}: DraftGuardOptions): void {
    const authStore = useAuthStore();
    const uiStore = useUIStore();

    onBeforeRouteLeave(() => {
        const n = count();
        if (n === 0 || !authStore.isAuthenticated) return true;
        if (saving()) {
            uiStore.queueMessage(Color.INFO, 'Saving… please wait');
            return false;
        }
        const drafts = `You have ${unsavedDrafts(n)}`;
        const them = n === 1 ? 'it' : 'them';
        if (authStore.userLogoutPending) {
            return confirm({
                title: 'Log out?',
                message: `${drafts}. Log out and discard ${them}?`,
                confirmLabel: 'Log out',
                cancelLabel: 'Stay',
                danger: true,
            });
        }
        return confirm({
            title: 'Leave this page?',
            message: `${drafts}. Leave and discard ${them}?`,
            confirmLabel: 'Leave',
            cancelLabel: 'Stay',
            danger: true,
        });
    });

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        // Older browsers show the prompt only when this is set.
        event.returnValue = '';
    };

    let listening = false;
    function listen(on: boolean): void {
        if (on === listening) return;
        listening = on;
        if (on) window.addEventListener('beforeunload', onBeforeUnload);
        else window.removeEventListener('beforeunload', onBeforeUnload);
    }

    watch(() => count() > 0, listen, { immediate: true });
    onBeforeUnmount(() => listen(false));
}

/** The question asked before "Clear Drafts" empties the page. */
export function clearDraftsRequest(count: number): ConfirmRequest {
    return {
        title: 'Clear drafts?',
        message:
            count === 1
                ? 'Clear the 1 draft? This cannot be undone.'
                : `Clear all ${count} drafts? This cannot be undone.`,
        confirmLabel: 'Clear',
        cancelLabel: 'Keep',
        danger: true,
    };
}
