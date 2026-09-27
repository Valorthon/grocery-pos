import axios, {
    AxiosError,
    isAxiosError,
    type InternalAxiosRequestConfig,
} from 'axios';
import constant from '@/constant';
import { useAuthStore } from './stores/auth';
import { env } from './config/env';
import { clearSessionMarker } from './utils/session-cookie';

interface QueuePromise {
    resolve: (value?: unknown) => void;
    reject: (reason?: unknown) => void;
}

const api = axios.create({
    baseURL: env.VITE_API_URL,
    timeout: env.VITE_API_TIMEOUT,
    headers: {
        Accept: 'application/json',
    },
    withCredentials: true,
});

let isSessionDialogShown = false;
let isRefreshing = false;
let failedQueue: QueuePromise[] = [];

const processQueue = (error: AxiosError | null) => {
    failedQueue.forEach((prom) => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve();
        }
    });

    failedQueue = [];
};

/**
 * A 401 from the auth routes is an answer, not an expired session: a wrong
 * password on login must reach the login form, and logout must not start a
 * refresh. (The refresh call itself goes through bare `axios`, not `api`, so
 * it never reaches this interceptor.)
 */
const AUTH_ENDPOINTS = [constant.login, constant.logout];
export const isAuthEndpoint = (url?: string): boolean => {
    const path = url?.split('?')[0];
    return !!path && AUTH_ENDPOINTS.some((endpoint) => path.endsWith(endpoint));
};

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    if (config.data instanceof FormData) {
        delete config.headers['Content-Type'];
    } else {
        config.headers['Content-Type'] = 'application/json';
    }

    return config;
});

/**
 * Refreshes the session (rotates the refresh token, issues a new access
 * token). Single-flight: while one refresh is in flight, later callers
 * wait for it and share its outcome. Only a 401 from the refresh ends the
 * session (logout, once per lost session); a timeout, network error or
 * 5xx rejects and keeps the user logged in. Used by the 401 interceptor
 * below and after a self-rename, so the access token carries the new
 * username (#106).
 */
export function refreshSession(): Promise<void> {
    if (isRefreshing) {
        return new Promise<void>((resolve, reject) => {
            failedQueue.push({ resolve: () => resolve(), reject });
        });
    }
    isRefreshing = true;
    return (async () => {
        try {
            // Bare axios, so a 401 here cannot recurse into the
            // interceptor. Bounded like every other call (bare axios
            // defaults to no timeout, which would park every queued
            // request forever). Any 2xx is success: axios rejects
            // anything else.
            await axios.post(
                `${env.VITE_API_URL}${constant.refresh}`,
                {},
                {
                    withCredentials: true, // Send cookies with refresh token
                    timeout: env.VITE_API_TIMEOUT,
                },
            );
            processQueue(null);
            isRefreshing = false;
            isSessionDialogShown = false;
        } catch (refreshError) {
            console.error('Token refresh failed:', refreshError);

            processQueue(refreshError as AxiosError);
            isRefreshing = false;

            // Only a 401 means the session is over. A 5xx or a network
            // error is transient: the server kept the cookies, so keep
            // the user logged in and let the caller fail on its own.
            const sessionOver =
                isAxiosError(refreshError) &&
                refreshError.response?.status === 401;
            if (sessionOver) {
                clearSessionMarker(env.VITE_DOMAIN);

                if (!isSessionDialogShown) {
                    isSessionDialogShown = true;
                    // Shown by logout after it clears the old toasts.
                    const authStore = useAuthStore();
                    void authStore.logout('Please log in to continue');
                }
            }
            throw refreshError;
        }
    })();
}

// RESPONSE interceptor with intelligent refresh token logic.
//
// Replays after a refresh resend `originalRequest` as it was, body
// included. That is safe for `POST /sales`: its body carries the sale's
// idempotency key, so a replay can only return the sale already recorded
// under it, never record a second one. (A 401 also comes from the auth
// guard before the handler runs, so the first attempt was not recorded.)
// Any new non-idempotent POST must carry a key the same way before it can
// go through this path. Queued replays are marked `_retry` too, so each
// request is refreshed for at most once: a second 401 is final.
api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & {
            _retry?: boolean;
        };
        // A 401 is the session's answer: every AUTH_* ErrorCode is a 401 on
        // the API (and nothing else is), so the status is the check here.
        // Where a specific reason matters, callers read `apiErrorCode`.
        if (
            error.response?.status === 401 &&
            !originalRequest._retry &&
            !isAuthEndpoint(originalRequest.url)
        ) {
            // One refresh per request: if the replay 401s too, it is
            // rejected instead of refreshing again. A refresh failure
            // rejects with the refresh's own error.
            originalRequest._retry = true;
            await refreshSession();
            return api(originalRequest);
        }

        // For other errors, just reject
        return Promise.reject(error);
    },
);

export default api;
