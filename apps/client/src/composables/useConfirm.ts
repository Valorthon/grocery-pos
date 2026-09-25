import { onScopeDispose, shallowRef } from 'vue';

/** What a `ConfirmDialog` asks. */
export interface ConfirmRequest {
    title: string;
    message: string;
    /** The action's label, e.g. "Clear" or "Leave". */
    confirmLabel?: string;
    /** The safe choice's label; it gets the focus. */
    cancelLabel?: string;
    /** Styles the action as destructive. */
    danger?: boolean;
}

/**
 * An in-app yes/no question (issue #19). `confirm` opens the page's
 * `<ConfirmDialog :request="request" @answer="answer" />` and resolves
 * true only when the action is chosen; Cancel, Escape and the backdrop
 * resolve false. Asking again while a question is open answers the old
 * one false, and so does unmounting the page.
 */
export function useConfirm() {
    const request = shallowRef<ConfirmRequest | null>(null);
    let resolve: ((ok: boolean) => void) | null = null;

    function answer(ok: boolean): void {
        const done = resolve;
        resolve = null;
        request.value = null;
        done?.(ok);
    }

    function confirm(next: ConfirmRequest): Promise<boolean> {
        answer(false);
        request.value = next;
        return new Promise<boolean>((res) => {
            resolve = res;
        });
    }

    onScopeDispose(() => answer(false));

    return { request, confirm, answer };
}
