import { isAxiosError } from 'axios';

export const LOGIN_ERRORS = {
    /**
     * Any rejected login. The API answers an unknown user, a wrong
     * password and a deactivated account with the same 401 (#12), and the
     * form must not tell them apart either.
     */
    credentials: 'Incorrect username or password.',
    rateLimited: 'Too many attempts. Try again in a few minutes.',
    unreachable: "Can't reach the server. Try again.",
} as const;

/** "in 45 seconds", "in 1 minute", "in 15 minutes". */
function waitPhrase(seconds: number): string {
    if (seconds < 60) return `in ${seconds} second${seconds === 1 ? '' : 's'}`;
    const minutes = Math.ceil(seconds / 60);
    return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * What the login form says when signing in fails (#21). Decided by the
 * status, never by the API's error code or text, so users never see a raw
 * code like `AUTH_001`:
 * - 400/401: the one generic credentials message. A 400 is input the API
 *   refused outright (e.g. too long), which cannot be a valid login.
 * - 429: too many attempts, with the wait from `details.retryAfterS` when
 *   the API gives one.
 * - anything else (no response, a timeout, a 5xx): the server is
 *   unreachable or broken, not the user's input.
 */
export function loginErrorMessage(err: unknown): string {
    const status = isAxiosError(err) ? err.response?.status : undefined;

    if (status === 400 || status === 401) return LOGIN_ERRORS.credentials;

    if (status === 429) {
        const data: unknown = isAxiosError(err) ? err.response?.data : null;
        const retryAfterS = (
            data as { details?: { retryAfterS?: unknown } } | null
        )?.details?.retryAfterS;
        return typeof retryAfterS === 'number' &&
            Number.isFinite(retryAfterS) &&
            retryAfterS > 0
            ? `Too many attempts. Try again ${waitPhrase(Math.ceil(retryAfterS))}.`
            : LOGIN_ERRORS.rateLimited;
    }

    return LOGIN_ERRORS.unreachable;
}
