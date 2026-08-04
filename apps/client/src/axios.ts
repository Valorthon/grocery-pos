import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import constant from '@/constant';
import { useAuthStore } from './stores/auth';
import { Color, useUIStore } from './stores/ui';
import { env } from './config/env';

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

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    if (config.data instanceof FormData) {
        delete config.headers['Content-Type'];
    } else {
        config.headers['Content-Type'] = 'application/json';
    }

    return config;
});

// RESPONSE interceptor with intelligent refresh token logic
api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & {
            _retry?: boolean;
        };
        console.log({ error });
        // Check if error is 401 and we haven't tried to refresh yet
        if (error.response?.status === 401 && !originalRequest._retry) {
            // If already refreshing, queue this request
            if (isRefreshing) {
                return new Promise((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                })
                    .then(() => {
                        return api(originalRequest);
                    })
                    .catch((err) => {
                        return Promise.reject(err);
                    });
            }

            originalRequest._retry = true;
            isRefreshing = true;

            try {
                // Call refresh endpoint
                const response = await axios.post(
                    `${env.VITE_API_URL}${constant.refresh}`,
                    {},
                    {
                        withCredentials: true, // Send cookies with refresh token
                    },
                );

                console.log('REFRESH');
                console.log({ response });
                if (response.status !== 201) {
                    throw new Error('Refresh failed');
                }

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
