import type { CookieOptions, Response } from 'express';
import {
    LEGACY_REFRESH_COOKIE_PATH,
    REFRESH_COOKIE_PATH,
} from '../../../constants';
import { TypedConfigService } from '../../typed-config/typed-config.service';
import { CookieService, msUntil } from './cookie.service';

const NOW = new Date('2026-09-26T08:00:00.000Z');
const JWT_EXPIRY_S = 900;

type Call = [name: string, value: string | undefined, options: CookieOptions];

function fakeResponse() {
    const set: Call[] = [];
    const cleared: Call[] = [];
    const res = {
        cookie: (name: string, value: string, options: CookieOptions) =>
            set.push([name, value, options]),
        clearCookie: (name: string, options: CookieOptions) =>
            cleared.push([name, undefined, options]),
    } as unknown as Response;
    return { res, set, cleared };
}

function service(env: { NODE_ENV: string; DOMAIN?: string }) {
    const values: Record<string, unknown> = { JWT_EXPIRY_S, ...env };
    return new CookieService({
        get: (key: string) => values[key],
    } as unknown as TypedConfigService);
}

beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
    jest.useRealTimers();
});

/**
 * The secure / sameSite / domain matrix (issue #30). Getting it wrong fails
 * silently in the browser:
 * - prod without DOMAIN means the client and API live on different sites,
 *   so the cookies must be `SameSite=None; Secure` or the browser never
 *   sends them back and every session dies after one request;
 * - with DOMAIN they share a site, so `Lax` (the safer choice) works and the
 *   cookies are scoped to that domain;
 * - dev runs over plain http, where a `Secure` cookie is dropped.
 */
describe.each([
    {
        env: { NODE_ENV: 'dev' },
        secure: false,
        sameSite: 'lax',
        domain: undefined,
    },
    {
        env: { NODE_ENV: 'dev', DOMAIN: 'localhost' },
        secure: false,
        sameSite: 'lax',
        domain: 'localhost',
    },
    {
        env: { NODE_ENV: 'prod', DOMAIN: '' },
        secure: true,
        sameSite: 'none',
        domain: undefined,
    },
    {
        env: { NODE_ENV: 'prod', DOMAIN: '.example.com' },
        secure: true,
        sameSite: 'lax',
        domain: '.example.com',
    },
])('CookieService in $env.NODE_ENV, DOMAIN=$env.DOMAIN', (row) => {
    const expiry = new Date(NOW.getTime() + 7 * 24 * 3600 * 1000);

    it('sets every cookie with the matrix attributes', () => {
        const { res, set } = fakeResponse();
        const cookies = service(row.env);
        cookies.createJwt(res, 'jwt-value', expiry);
        cookies.createRefresh(res, 'refresh-value', expiry);
        cookies.createDummy(res, expiry);

        expect(set).toHaveLength(3);
        for (const [, , options] of set) {
            expect(options).toMatchObject({
                secure: row.secure,
                sameSite: row.sameSite,
                domain: row.domain,
            });
        }
    });

    it('clears each cookie with the same attributes it was set with', () => {
        // A browser only deletes a cookie whose path and domain match the
        // one it stored: a mismatch leaves the session cookie behind after
        // logout.
        const setRes = fakeResponse();
        const clearRes = fakeResponse();
        const cookies = service(row.env);
        cookies.createJwt(setRes.res, 'j', expiry);
        cookies.createRefresh(setRes.res, 'r', expiry);
        cookies.createDummy(setRes.res, expiry);
        cookies.removeJwt(clearRes.res);
        cookies.removeRefresh(clearRes.res);
        cookies.removeDummy(clearRes.res);

        const attrs = ([name, , o]: Call) => ({
            name,
            path: o.path,
            domain: o.domain,
            secure: o.secure,
            sameSite: o.sameSite,
            httpOnly: o.httpOnly,
            signed: o.signed,
        });
        const cleared = clearRes.cleared.map(attrs);
        for (const call of setRes.set) {
            expect(cleared).toContainEqual(attrs(call));
        }
    });
});

describe('CookieService cookie roles', () => {
    const expiry = new Date(NOW.getTime() + 3 * 3600 * 1000);

    it('keeps the session cookies httpOnly and signed, and the marker readable', () => {
        // The client can read `dummy` to know a session exists, but never
        // the tokens themselves.
        const { res, set } = fakeResponse();
        const cookies = service({ NODE_ENV: 'prod', DOMAIN: '.example.com' });
        cookies.createJwt(res, 'j', expiry);
        cookies.createRefresh(res, 'r', expiry);
        cookies.createDummy(res, expiry);

        const byName = Object.fromEntries(set.map(([n, , o]) => [n, o]));
        expect(byName.jwt).toMatchObject({ httpOnly: true, signed: true });
        expect(byName.refresh).toMatchObject({ httpOnly: true, signed: true });
        expect(byName.dummy).toMatchObject({ httpOnly: false, signed: false });
        expect(set.find(([n]) => n === 'dummy')?.[1]).toBe('true');
    });

    it('scopes the refresh cookie to the auth routes and clears the legacy path first (#12)', () => {
        const { res, set, cleared } = fakeResponse();
        service({ NODE_ENV: 'dev' }).createRefresh(res, 'r', expiry);

        expect(cleared).toEqual([
            [
                'refresh',
                undefined,
                expect.objectContaining({
                    path: LEGACY_REFRESH_COOKIE_PATH,
                }),
            ],
        ]);
        expect(set).toEqual([
            [
                'refresh',
                'r',
                expect.objectContaining({
                    path: REFRESH_COOKIE_PATH,
                }),
            ],
        ]);
    });

    it('removeRefresh clears both the current and the legacy path', () => {
        const { res, cleared } = fakeResponse();
        service({ NODE_ENV: 'dev' }).removeRefresh(res);
        expect(cleared.map(([, , o]) => o.path).sort()).toEqual(
            [LEGACY_REFRESH_COOKIE_PATH, REFRESH_COOKIE_PATH].sort(),
        );
    });

    it('the refresh and marker cookies expire with the session, not a fresh REFRESH_EXPIRY_S (#21)', () => {
        const { res, set } = fakeResponse();
        const cookies = service({ NODE_ENV: 'dev' });
        cookies.createRefresh(res, 'r', expiry);
        cookies.createDummy(res, expiry);
        for (const [, , o] of set) {
            expect(o.maxAge).toBe(3 * 3600 * 1000);
        }
    });

    it('the access cookie lives JWT_EXPIRY_S, but never past the session end (#21)', () => {
        const long = fakeResponse();
        service({ NODE_ENV: 'dev' }).createJwt(long.res, 'j', expiry);
        expect(long.set[0][2].maxAge).toBe(JWT_EXPIRY_S * 1000);

        const ending = new Date(NOW.getTime() + 60_000);
        const short = fakeResponse();
        service({ NODE_ENV: 'dev' }).createJwt(short.res, 'j', ending);
        expect(short.set[0][2].maxAge).toBe(60_000);
    });
});

describe('msUntil', () => {
    it('is the milliseconds left, and 0 (never negative) once the time has passed', () => {
        // A negative maxAge would be sent as an already-expired cookie by
        // some versions and ignored by others.
        expect(msUntil(new Date(NOW.getTime() + 1234))).toBe(1234);
        expect(msUntil(new Date(NOW.getTime() - 5000))).toBe(0);
    });
});
