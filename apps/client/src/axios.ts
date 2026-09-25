import axios, {
    AxiosError,
    isAxiosError,
    type InternalAxiosRequestConfig,
} from 'axios';
import constant from '@/constant';
import { useAuthStore } from './stores/auth';
import { Color, useUIStore } from './stores/ui';
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
        // Check if error is 401 and we haven't tried to refresh yet
        if (
            error.response?.status === 401 &&
            !originalRequest._retry &&
            !isAuthEndpoint(originalRequest.url)
        ) {
            // If already refreshing, queue this request
            if (isRefreshing) {
                return new Promise((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                })
                    .then(() => {
                        // One refresh per request: if the replay 401s too,
                        // it is rejected instead of refreshing again.
                        originalRequest._retry = true;
                        return api(originalRequest);
                    })
                    .catch((err) => {
                        return Promise.reject(err);
                    });
            }

            originalRequest._retry = true;
            isRefreshing = true;

            try {
                // Bare axios, so a 401 here cannot recurse into this
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

                // Process queued requests
                processQueue(null);

                isRefreshing = false;

                // Retry original request
                isSessionDialogShown = false;

                return api(originalRequest);
            } catch (refreshError) {
                console.error('Token refresh failed:', refreshError);

                processQueue(refreshError as AxiosError);
                isRefreshing = false;

                // Only a 401 means the session is over. A 5xx or a network
                // error is transient: the server kept the cookies, so keep
                // the user signed in and let this request fail on its own.
                const sessionOver =
                    isAxiosError(refreshError) &&
                    refreshError.response?.status === 401;
                if (!sessionOver) return Promise.reject(refreshError);

                clearSessionMarker(env.VITE_DOMAIN);

                if (!isSessionDialogShown) {
                    isSessionDialogShown = true;
                    const uiStore = useUIStore();
                    uiStore.queueMessage(
                        Color.ERROR,
                        'Please log in to continue',
                    );
                    const authStore = useAuthStore();
                    authStore.logout();
                }

                return Promise.reject(refreshError);
            }
        }

        // For other errors, just reject
        return Promise.reject(error);
    },
);

export default api;
