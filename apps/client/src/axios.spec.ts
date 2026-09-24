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

    it.each(['/auth/refresh', '/auth/logout'])(
        'does not start a refresh on a 401 from %s',
        async (url) => {
            api.defaults.adapter = ((config) =>
                fail(config, 401)) as AxiosAdapter;

            await expect(api.post(url)).rejects.toBeInstanceOf(AxiosError);
            expect(refresh).not.toHaveBeenCalled();
        },
    );
});

describe('isAuthEndpoint', () => {
    it('matches only the auth routes', () => {
        expect(isAuthEndpoint('/auth/login')).toBe(true);
        expect(isAuthEndpoint('/auth/refresh')).toBe(true);
        expect(isAuthEndpoint('/auth/logout')).toBe(true);
        expect(isAuthEndpoint('/users/profile')).toBe(false);
        expect(isAuthEndpoint(undefined)).toBe(false);
    });
});
