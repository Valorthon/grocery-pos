import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ErrorCode,
    WIRE_VERSION,
    WIRE_VERSION_HEADER,
} from '@grocery-pos/contracts';
import axios, {
    AxiosError,
    AxiosHeaders,
    type InternalAxiosRequestConfig,
} from 'axios';

// The single-pc bundle (#358): same-origin relative API base, no domain.
vi.mock('@/config/env', () => ({
    env: {
        VITE_APP_ENV: 'single-pc',
        VITE_API_URL: '/v1',
        VITE_API_TIMEOUT: 1000,
        VITE_DOMAIN: undefined,
    },
}));

const logout = vi.fn();
vi.mock('./stores/auth', () => ({ useAuthStore: () => ({ logout }) }));
vi.mock('./stores/ui', () => ({
    Color: { ERROR: 'error' },
    useUIStore: () => ({ queueMessage: vi.fn() }),
}));

const { default: api, refreshSession } = await import('./axios');

afterEach(() => {
    vi.restoreAllMocks();
});

describe('single-pc API base (#358)', () => {
    it('sends requests to the same origin under /v1', () => {
        expect(api.defaults.baseURL).toBe('/v1');
    });

    it('names its wire version on every request (#364 stale tabs)', () => {
        expect(
            (api.defaults.headers as unknown as Record<string, unknown>)[
                WIRE_VERSION_HEADER
            ],
        ).toBe(String(WIRE_VERSION));
    });

    it('refreshes at the same-origin /v1/auth/refresh', async () => {
        const post = vi.spyOn(axios, 'post').mockResolvedValue({ status: 204 });
        await refreshSession();
        expect(post).toHaveBeenCalledWith(
            '/v1/auth/refresh',
            {},
            expect.objectContaining({
                withCredentials: true,
                headers: { [WIRE_VERSION_HEADER]: String(WIRE_VERSION) },
            }),
        );
    });

    it('opens the reload dialog when the upgraded API refuses this build', async () => {
        const { clientOutdated } = await import('./utils/client-outdated');
        clientOutdated.value = false;
        const adapter = api.defaults.adapter;
        api.defaults.adapter = (config) =>
            Promise.reject(
                new AxiosError(
                    '409',
                    AxiosError.ERR_BAD_REQUEST,
                    config,
                    null,
                    {
                        status: 409,
                        statusText: '409',
                        data: {
                            statusCode: 409,
                            error: ErrorCode.CLIENT_OUTDATED,
                            message:
                                'Grocery POS was updated. Reload to continue.',
                        },
                        headers: new AxiosHeaders(),
                        config,
                    },
                ),
            );
        try {
            await expect(api.get('/settings/today')).rejects.toBeInstanceOf(
                AxiosError,
            );
            expect(clientOutdated.value).toBe(true);
        } finally {
            api.defaults.adapter = adapter;
            clientOutdated.value = false;
        }
    });

    it('clears the session marker host-only when the session is over', async () => {
        const config = {
            headers: new AxiosHeaders(),
        } as InternalAxiosRequestConfig;
        vi.spyOn(axios, 'post').mockRejectedValue(
            new AxiosError('401', AxiosError.ERR_BAD_REQUEST, config, null, {
                status: 401,
                statusText: '401',
                data: {},
                headers: new AxiosHeaders(),
                config,
            }),
        );
        const written: string[] = [];
        vi.spyOn(document, 'cookie', 'set').mockImplementation((value) => {
            written.push(value);
        });

        await expect(refreshSession()).rejects.toBeInstanceOf(AxiosError);

        const marker = written.find((c) => c.startsWith('dummy='));
        expect(marker).toBeDefined();
        expect(marker).toContain('path=/');
        expect(marker).not.toMatch(/domain=/i);
    });
});
