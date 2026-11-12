import { onBeforeUnmount, ref } from 'vue';
import { ErrorCode } from '@grocery-pos/contracts';
import { apiErrorCode } from '@/utils/api-error';

/** Thrown by `withReauth` when the user cancels "Confirm it's you". */
export class ReauthCancelledError extends Error {
    constructor() {
        super('Re-authentication cancelled');
        this.name = 'ReauthCancelledError';
    }
}

export function isReauthCancelled(error: unknown): boolean {
    return error instanceof ReauthCancelledError;
}

/**
 * Step-up re-authentication (#310). `withReauth(run)` runs a save; when the
 * server answers 403 `USER_REAUTH_REQUIRED` it opens `ReauthDialog` and,
 * once the password is confirmed, runs the same save once more, unchanged.
 * A cancel rejects with `ReauthCancelledError` (nothing was saved). The
 * client never tracks the window: the server decides when to ask.
 */
export function useReauth() {
    const isReauthOpen = ref(false);
    let settle: ((confirmed: boolean) => void) | null = null;

    function finish(confirmed: boolean) {
        const resolve = settle;
        settle = null;
        isReauthOpen.value = false;
        resolve?.(confirmed);
    }

    function askReauth(): Promise<boolean> {
        finish(false);
        isReauthOpen.value = true;
        return new Promise((resolve) => {
            settle = resolve;
        });
    }

    async function withReauth<T>(run: () => Promise<T>): Promise<T> {
        try {
            return await run();
        } catch (error) {
            if (apiErrorCode(error) !== ErrorCode.USER_REAUTH_REQUIRED)
                throw error;
            if (!(await askReauth())) throw new ReauthCancelledError();
            return await run();
        }
    }

    onBeforeUnmount(() => finish(false));

    return {
        isReauthOpen,
        withReauth,
        completeReauth: () => finish(true),
        cancelReauth: () => finish(false),
    };
}
