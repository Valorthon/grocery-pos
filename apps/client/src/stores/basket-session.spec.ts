import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import axios, {
    AxiosError,
    AxiosHeaders,
    type AxiosAdapter,
    type AxiosResponse,
    type InternalAxiosRequestConfig,
} from 'axios';
import { Role } from '@grocery-pos/contracts';

/*
 * The saved basket through the real axios interceptor and auth store
 * (#23 review): a refresh that fails with 401 mid-session ends it through
 * `logout(reason)`, and that removes the cashier's saved basket.
 */

vi.mock('@/config/env', () => ({
    env: {
        VITE_API_URL: 'http://api.test/v1',
        VITE_API_TIMEOUT: 1000,
        VITE_DOMAIN: '',
    },
}));

const push = vi.fn();
vi.mock('@/router', () => ({
    default: { push, currentRoute: { value: { name: 'Login' } } },
}));

const ANA = { userId: 'u-ana', username: 'ana', roles: [Role.Seller] };
const BASKET_KEY = 'grocery_pos_cart_v1:u-ana';
const BASKET = JSON.stringify({
    version: 1,
    items: [
        {
            product: 'p1',
            EAN: '2000000000015',
            name: 'milk',
            unitPrice: 9500,
            quantity: 2,
        },
    ],
    discount: null,
    attempt: { idempotencyKey: 'key-1', ticketSignature: '{}' },
});

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

function unauthorized(config: InternalAxiosRequestConfig) {
    return new AxiosError(
        'Request failed with status code 401',
        AxiosError.ERR_BAD_REQUEST,
        config,
        undefined,
        respond(config, 401, { error: 'AUTH_002' }),
    );
}

beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    push.mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('saved basket and a forced logout (#23 review)', () => {
    it('is removed when a refresh fails with 401 mid-session', async () => {
        localStorage.setItem('user', JSON.stringify(ANA));
        localStorage.setItem(BASKET_KEY, BASKET);

        const { default: api } = await import('@/axios');
        const { useAuthStore } = await import('./auth');
        const { useCartStore } = await import('./cart');
        const auth = useAuthStore();
        const cart = useCartStore();
        expect(cart.owner).toBe('u-ana');
        expect(cart.items).toHaveLength(1);

        // Every API call is refused as expired; logout itself goes through.
        api.defaults.adapter = ((config) =>
            config.url === '/auth/logout'
                ? Promise.resolve(respond(config, 204))
                : Promise.reject(unauthorized(config))) as AxiosAdapter;
        // The refresh (bare axios) says the session is over.
        vi.spyOn(axios, 'post').mockImplementation((url) =>
            Promise.reject(
                unauthorized({
                    url,
                    headers: new AxiosHeaders(),
                } as InternalAxiosRequestConfig),
            ),
        );
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(api.get('/sales')).rejects.toBeTruthy();
        await vi.waitFor(() => expect(push).toHaveBeenCalled());

        expect(auth.user).toBeNull();
        expect(cart.items).toEqual([]);
        expect(cart.attempt).toBeNull();
        expect(cart.owner).toBeNull();
        expect(localStorage.getItem(BASKET_KEY)).toBeNull();

        api.defaults.adapter = undefined;
    });
});
