import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
    type MockInstance,
} from 'vitest';
import axios, {
    AxiosError,
    AxiosHeaders,
    type AxiosAdapter,
    type AxiosResponse,
    type InternalAxiosRequestConfig,
} from 'axios';

vi.mock('@/config/env', () => ({
    env: {
        VITE_API_URL: 'http://api.test/v1',
        VITE_API_TIMEOUT: 1000,
        VITE_DOMAIN: '',
    },
}));

const logout = vi.fn();
vi.mock('./stores/auth', () => ({ useAuthStore: () => ({ logout }) }));
vi.mock('./stores/ui', () => ({
    Color: { ERROR: 'error' },
    useUIStore: () => ({ queueMessage: vi.fn() }),
}));

const { default: api, isAuthEndpoint } = await import('./axios');

function respond(
    config: InternalAxiosRequestConfig,
    status: number,
    data: unknown = {},
): AxiosResponse {
    return {
        status,
        statusText: String(status),
        data,
        headers: new AxiosHeaders(),
        config,
    };
}

/** Rejects like axios does for a non-2xx response. */
function fail(config: InternalAxiosRequestConfig, status: number, data = {}) {
    const response = respond(config, status, data);
    return Promise.reject(
        new AxiosError(
            `Request failed with status code ${status}`,
            AxiosError.ERR_BAD_REQUEST,
            config,
            undefined,
            response,
        ),
    );
}

describe('api 401 handling', () => {
    let refresh: MockInstance<typeof axios.post>;

    beforeEach(() => {
        logout.mockReset();
        refresh = vi.spyOn(axios, 'post');
    });

    afterEach(() => {
        api.defaults.adapter = undefined;
    });

    it('refreshes the session on a 401 and replays the request', async () => {
        let calls = 0;
        api.defaults.adapter = ((config) => {
            calls += 1;
            return calls === 1
                ? fail(config, 401, { error: 'AUTH_002' })
                : Promise.resolve(respond(config, 200, { ok: true }));
        }) as AxiosAdapter;
        refresh.mockResolvedValue({ status: 201 });

        const res = await api.get('/users/profile');

        expect(res.data).toEqual({ ok: true });
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(refresh.mock.calls[0]?.[0]).toBe(
            'http://api.test/v1/auth/refresh',
        );
        expect(calls).toBe(2);
    });

    it('accepts any 2xx from the refresh, not only 201 (#21)', async () => {
        let calls = 0;
        api.defaults.adapter = ((config) => {
            calls += 1;
            return calls === 1
                ? fail(config, 401, { error: 'AUTH_002' })
                : Promise.resolve(respond(config, 200, { ok: true }));
        }) as AxiosAdapter;
        refresh.mockResolvedValue({ status: 200 });

        const res = await api.get('/users/profile');

        expect(res.data).toEqual({ ok: true });
        expect(logout).not.toHaveBeenCalled();
    });

    it('bounds the refresh with the API timeout (#21)', async () => {
        let calls = 0;
        api.defaults.adapter = ((config) => {
            calls += 1;
            return calls === 1
                ? fail(config, 401)
                : Promise.resolve(respond(config, 200));
        }) as AxiosAdapter;
        refresh.mockResolvedValue({ status: 201 });

        await api.get('/users/profile');

        expect(refresh.mock.calls[0]?.[2]).toMatchObject({
            timeout: 1000,
            withCredentials: true,
        });
    });

    it('refreshes once for requests queued behind a refresh; a second 401 is final (#21)', async () => {
        const seen: string[] = [];
        // Every request 401s, before and after the refresh.
        api.defaults.adapter = ((config) => {
            seen.push(config.url ?? '');
            return fail(config, 401, { error: 'AUTH_002' });
        }) as AxiosAdapter;
        refresh.mockImplementation(
            () =>
                new Promise((resolve) =>
                    setTimeout(() => resolve({ status: 201 }), 5),
                ),
        );

        const results = await Promise.allSettled([
            api.get('/users/profile'),
            api.get('/products'),
            api.get('/shifts/current'),
        ]);

        expect(refresh).toHaveBeenCalledTimes(1);
        expect(results.map((r) => r.status)).toEqual([
            'rejected',
            'rejected',
            'rejected',
        ]);
        for (const r of results) {
            expect(
                ((r as PromiseRejectedResult).reason as AxiosError).response
                    ?.status,
            ).toBe(401);
        }
        // Each request went out twice: the original and one replay.
        expect(seen.sort()).toEqual([
            '/products',
            '/products',
            '/shifts/current',
            '/shifts/current',
            '/users/profile',
            '/users/profile',
        ]);
    });

    it('passes a 401 from login straight to the caller without refreshing', async () => {
        api.defaults.adapter = ((config) =>
            fail(config, 401, { error: 'AUTH_001' })) as AxiosAdapter;

        const err = await api
            .post('/auth/login', { username: 'x', password: 'y' })
            .catch((e: unknown) => e);

        expect(refresh).not.toHaveBeenCalled();
        expect(logout).not.toHaveBeenCalled();
        expect((err as AxiosError).response?.status).toBe(401);
        expect(
            (err as AxiosError<{ error: string }>).response?.data.error,
        ).toBe('AUTH_001');
    });

    it('does not start a refresh on a 401 from /auth/logout', async () => {
        api.defaults.adapter = ((config) => fail(config, 401)) as AxiosAdapter;

        await expect(api.post('/auth/logout')).rejects.toBeInstanceOf(
            AxiosError,
        );
        expect(refresh).not.toHaveBeenCalled();
    });
});

describe('api when the refresh itself fails', () => {
    const REFRESH_CONFIG = {
        headers: new AxiosHeaders(),
    } as InternalAxiosRequestConfig;

    let refresh: MockInstance<typeof axios.post>;
    let cookieWrites: string[];

    beforeEach(() => {
        logout.mockReset();
        refresh = vi.spyOn(axios, 'post');
        cookieWrites = [];
        vi.spyOn(console, 'error').mockImplementation(() => {});
        Object.defineProperty(document, 'cookie', {
            configurable: true,
            get: () => 'dummy=true',
            set: (value: string) => cookieWrites.push(value),
        });
        // Every protected request 401s, so each one waits on the refresh.
        api.defaults.adapter = ((config) =>
            fail(config, 401, { error: 'AUTH_002' })) as AxiosAdapter;
    });

    afterEach(() => {
        api.defaults.adapter = undefined;
    });

    /** Fires two protected requests while one refresh is in flight. */
    async function twoRequestsDuringRefresh(refreshError: unknown) {
        refresh.mockImplementation(
            () =>
                new Promise((_resolve, reject) =>
                    setTimeout(() => reject(refreshError), 5),
                ),
        );

        const results = await Promise.allSettled([
            api.get('/users/profile'),
            api.get('/products'),
        ]);

        expect(refresh).toHaveBeenCalledTimes(1);
        return results;
    }

    it.each([
        [
            'a 5xx',
            new AxiosError(
                'Request failed with status code 503',
                AxiosError.ERR_BAD_RESPONSE,
                REFRESH_CONFIG,
                undefined,
                respond(REFRESH_CONFIG, 503),
            ),
        ],
        [
            'a network error',
            new AxiosError('Network Error', AxiosError.ERR_NETWORK),
        ],
    ])(
        'keeps the session on %s but rejects every waiting request',
        async (_label, refreshError) => {
            const results = await twoRequestsDuringRefresh(refreshError);

            expect(results.map((r) => r.status)).toEqual([
                'rejected',
                'rejected',
            ]);
            expect(
                results.map((r) => (r as PromiseRejectedResult).reason),
            ).toEqual([refreshError, refreshError]);
            expect(logout).not.toHaveBeenCalled();
            expect(cookieWrites).toEqual([]);
        },
    );

    it('logs out when the refresh answers 401', async () => {
        const refreshError = new AxiosError(
            'Request failed with status code 401',
            AxiosError.ERR_BAD_REQUEST,
            REFRESH_CONFIG,
            undefined,
            respond(REFRESH_CONFIG, 401, { error: 'AUTH_004' }),
        );

        const results = await twoRequestsDuringRefresh(refreshError);

        expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
        expect(logout).toHaveBeenCalledTimes(1);
        expect(cookieWrites).toEqual([
            expect.stringMatching(/^dummy=; expires=Thu, 01 Jan 1970/),
        ]);
    });
});

describe('isAuthEndpoint', () => {
    it('matches only the auth routes, ignoring the query string', () => {
        expect(isAuthEndpoint('/auth/login')).toBe(true);
        expect(isAuthEndpoint('/auth/login?next=/sales')).toBe(true);
        expect(isAuthEndpoint('/auth/logout')).toBe(true);
        expect(isAuthEndpoint('/users/profile')).toBe(false);
        expect(isAuthEndpoint('/users/profile?from=/auth/login')).toBe(false);
        expect(isAuthEndpoint(undefined)).toBe(false);
    });
});
