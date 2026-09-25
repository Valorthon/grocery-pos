import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, defineComponent, h, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import {
    AxiosError,
    AxiosHeaders,
    type AxiosResponse,
    type InternalAxiosRequestConfig,
} from 'axios';
import { Role } from '@grocery-pos/contracts';
import Login from './Login.vue';
import { LOGIN_ERRORS, loginErrorMessage } from './login-error';

const auth = vi.hoisted(() => ({
    login: vi.fn(),
    logout: vi.fn(),
    user: null as { username: string; roles: string[] } | null,
}));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }));

const Stub = defineComponent({ render: () => h('div') });

let app: App | null = null;
let router: Router;

async function flush() {
    for (let i = 0; i < 5; i++) await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 5; i++) await nextTick();
}

async function mount(): Promise<HTMLElement> {
    router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'Home', component: Stub },
            { path: '/login', name: 'Login', component: Stub },
            { path: '/seller', name: 'SellerDashboard', component: Stub },
            { path: '/dashboard', name: 'Dashboard', component: Stub },
        ],
    });
    await router.push('/login');
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp(Login);
    app.use(createPinia());
    app.use(router);
    app.mount(host);
    await flush();
    return host;
}

/** An axios error as the API client rejects with it. */
function httpError(status: number, data: unknown = {}): AxiosError {
    const config = {
        headers: new AxiosHeaders(),
    } as InternalAxiosRequestConfig;
    const response: AxiosResponse = {
        status,
        statusText: String(status),
        data,
        headers: new AxiosHeaders(),
        config,
    };
    return new AxiosError(
        `Request failed with status code ${status}`,
        status >= 500
            ? AxiosError.ERR_BAD_RESPONSE
            : AxiosError.ERR_BAD_REQUEST,
        config,
        undefined,
        response,
    );
}

function input(host: HTMLElement, name: string): HTMLInputElement {
    const el = host.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!el) throw new Error(`no input named ${name}`);
    return el;
}

async function submit(host: HTMLElement, username = 'ana', password = 'pw') {
    for (const [name, value] of [
        ['username', username],
        ['password', password],
    ]) {
        const el = input(host, name);
        el.value = value;
        el.dispatchEvent(new Event('input'));
    }
    host.querySelector('form')!.dispatchEvent(
        new Event('submit', { cancelable: true }),
    );
    await flush();
}

function errorBox(host: HTMLElement): HTMLElement | null {
    return host.querySelector('[role="alert"]');
}

beforeEach(() => {
    auth.login.mockReset();
    auth.logout.mockReset();
    auth.user = null;
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

describe('Login page (#21)', () => {
    it('has no dead controls: no remember-me, privacy, terms or forgot-password button', async () => {
        const host = await mount();
        const text = host.textContent ?? '';

        expect(text).not.toMatch(/remember me/i);
        expect(text).not.toMatch(/privacy/i);
        expect(text).not.toMatch(/terms/i);
        expect(host.querySelector('input[type="checkbox"]')).toBeNull();
        const buttons = [...host.querySelectorAll('button')].map(
            (b) => b.textContent?.trim() ?? '',
        );
        expect(buttons.some((t) => /forgot/i.test(t))).toBe(false);
        expect(
            host.querySelector('[data-testid="forgot-password"]')?.textContent,
        ).toContain('Forgot your password? Ask an admin to reset it.');
    });

    it('labels the fields for password managers, not as an email address', async () => {
        const host = await mount();

        const username = input(host, 'username');
        const password = input(host, 'password');
        expect(username.getAttribute('autocomplete')).toBe('username');
        expect(username.type).toBe('text');
        expect(username.placeholder).not.toMatch(/@/);
        expect(password.getAttribute('autocomplete')).toBe('current-password');
        expect(password.type).toBe('password');
    });

    describe('error messages', () => {
        it.each([
            [
                'a 401 (any rejected sign-in)',
                httpError(401, { error: 'AUTH_001', message: 'x' }),
                LOGIN_ERRORS.credentials,
            ],
            [
                'a 400 (input the API refused)',
                httpError(400, { error: 'VALIDATION_001' }),
                LOGIN_ERRORS.credentials,
            ],
            [
                'a 429 with the wait',
                httpError(429, {
                    error: 'RATE_LIMITED',
                    details: { retryAfterS: 900 },
                }),
                'Too many attempts. Try again in 15 minutes.',
            ],
            [
                'a 429 without details',
                httpError(429, {}),
                LOGIN_ERRORS.rateLimited,
            ],
            [
                'a 500',
                httpError(500, { error: 'INTERNAL_001' }),
                LOGIN_ERRORS.unreachable,
            ],
            [
                'a network failure',
                new AxiosError('Network Error', AxiosError.ERR_NETWORK),
                LOGIN_ERRORS.unreachable,
            ],
            [
                'a timeout',
                new AxiosError('timeout', AxiosError.ECONNABORTED),
                LOGIN_ERRORS.unreachable,
            ],
        ])('shows the right message for %s', async (_label, err, message) => {
            auth.login.mockRejectedValue(err);
            const host = await mount();

            await submit(host);

            expect(auth.login).toHaveBeenCalledWith('ana', 'pw');
            expect(errorBox(host)?.textContent?.trim()).toBe(message);
            expect(host.textContent).not.toMatch(/AUTH_|INTERNAL_|RATE_/);
            expect(router.currentRoute.value.name).toBe('Login');
        });

        it('shows no error box before a failed attempt', async () => {
            const host = await mount();

            expect(errorBox(host)).toBeNull();
        });

        it('goes home on success', async () => {
            auth.login.mockImplementation(() => {
                auth.user = { username: 'ana', roles: [Role.Seller] };
                return Promise.resolve({});
            });
            const host = await mount();

            await submit(host);

            expect(errorBox(host)).toBeNull();
            expect(router.currentRoute.value.name).not.toBe('Login');
        });
    });
});

describe('loginErrorMessage', () => {
    it.each([
        [1, 'in 1 second'],
        [45, 'in 45 seconds'],
        [60, 'in 1 minute'],
        [61, 'in 2 minutes'],
    ])('words a %is wait as "%s"', (retryAfterS, phrase) => {
        expect(
            loginErrorMessage(httpError(429, { details: { retryAfterS } })),
        ).toBe(`Too many attempts. Try again ${phrase}.`);
    });

    it('treats a non-axios failure as the server being unreachable', () => {
        expect(loginErrorMessage(new Error('boom'))).toBe(
            LOGIN_ERRORS.unreachable,
        );
    });
});
