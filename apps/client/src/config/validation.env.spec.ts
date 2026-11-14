import { describe, expect, it } from 'vitest';
import * as zod from 'zod';
import { envSchema, parseClientEnv, resolveAppEnv } from './validation.env';

const BASE = {
    VITE_APP_ENV: 'prod',
    VITE_API_URL: 'https://api.example.com/v1',
    VITE_API_TIMEOUT: '10000',
    VITE_DOMAIN: 'example.com',
};

function issuePaths(env: Record<string, unknown>): string[] {
    const result = envSchema.safeParse(env);
    return (result.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('client envSchema', () => {
    it('turns off zod JIT, whose eval probe the CSP reports (#29)', () => {
        expect(zod.config().jitless).toBe(true);
    });

    it('accepts a deployed build', () => {
        expect(issuePaths(BASE)).toEqual([]);
    });

    it.each(['prod', 'stage'])('requires VITE_DOMAIN in %s', (env) => {
        expect(
            issuePaths({ ...BASE, VITE_APP_ENV: env, VITE_DOMAIN: '' }),
        ).toEqual(['VITE_DOMAIN']);
        expect(
            issuePaths({ ...BASE, VITE_APP_ENV: env, VITE_DOMAIN: undefined }),
        ).toEqual(['VITE_DOMAIN']);
    });

    it.each(['dev', 'test'])('allows a blank VITE_DOMAIN in %s', (env) => {
        expect(
            issuePaths({ ...BASE, VITE_APP_ENV: env, VITE_DOMAIN: '' }),
        ).toEqual([]);
    });

    it.each(['https://example.com', 'example.com/x'])(
        'rejects the VITE_DOMAIN %s: a bare hostname only',
        (VITE_DOMAIN) => {
            expect(issuePaths({ ...BASE, VITE_DOMAIN })).toEqual([
                'VITE_DOMAIN',
            ]);
        },
    );

    it.each(['not-a-url', 'https://api.example.com/v1/'])(
        'rejects the VITE_API_URL %s',
        (VITE_API_URL) => {
            expect(issuePaths({ ...BASE, VITE_API_URL })).toEqual([
                'VITE_API_URL',
            ]);
        },
    );

    it.each(['0', '60001', '1.5'])('rejects the timeout %s', (timeout) => {
        expect(issuePaths({ ...BASE, VITE_API_TIMEOUT: timeout })).toEqual([
            'VITE_API_TIMEOUT',
        ]);
    });

    it('rejects an unknown VITE_APP_ENV', () => {
        expect(issuePaths({ ...BASE, VITE_APP_ENV: 'production' })).toEqual([
            'VITE_APP_ENV',
        ]);
    });
});

describe('client envSchema single-pc (#358)', () => {
    const SINGLE_PC = {
        VITE_APP_ENV: 'single-pc',
        VITE_API_URL: '/v1',
        VITE_API_TIMEOUT: '10000',
        VITE_DOMAIN: '',
    };

    it('accepts the same-origin relative API base without a domain', () => {
        expect(issuePaths(SINGLE_PC)).toEqual([]);
        expect(issuePaths({ ...SINGLE_PC, VITE_DOMAIN: undefined })).toEqual(
            [],
        );
    });

    it.each(['https://localhost:1443/v1', '/v1/', '/api', '//evil.example/v1'])(
        'refuses the VITE_API_URL %s',
        (VITE_API_URL) => {
            expect(issuePaths({ ...SINGLE_PC, VITE_API_URL })).toEqual([
                'VITE_API_URL',
            ]);
        },
    );

    it('refuses a VITE_DOMAIN: the marker is host-only', () => {
        expect(issuePaths({ ...SINGLE_PC, VITE_DOMAIN: 'localhost' })).toEqual([
            'VITE_DOMAIN',
        ]);
    });

    it.each(['prod', 'stage', 'dev', 'test'])(
        'keeps requiring an absolute URL in %s',
        (VITE_APP_ENV) => {
            expect(
                issuePaths({ ...BASE, VITE_APP_ENV, VITE_API_URL: '/v1' }),
            ).toEqual(['VITE_API_URL']);
        },
    );
});

describe('client env: VITE_APP_ENV (#86)', () => {
    const NO_STAGE: Record<string, unknown> = { ...BASE };
    delete NO_STAGE.VITE_APP_ENV;

    it('uses a trimmed VITE_APP_ENV', () => {
        const result = parseClientEnv({ ...BASE, VITE_APP_ENV: ' stage\t' });
        if (!result.success) throw new Error(result.error);
        expect(result.data.VITE_APP_ENV).toBe('stage');
    });

    it.each(['prod', 'stage', 'dev', 'production'])(
        'ignores the old VITE_NODE_ENV=%s: VITE_APP_ENV is still required',
        (legacy) => {
            const result = parseClientEnv({
                ...NO_STAGE,
                VITE_NODE_ENV: legacy,
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error).toContain('VITE_APP_ENV must be one of');
            }
        },
    );

    it('ignores a disagreeing VITE_NODE_ENV beside VITE_APP_ENV', () => {
        const result = parseClientEnv({ ...BASE, VITE_NODE_ENV: 'dev' });
        if (!result.success) throw new Error(result.error);
        expect(result.data.VITE_APP_ENV).toBe('prod');
        expect(result.data).not.toHaveProperty('VITE_NODE_ENV');
    });

    it.each(['', '  ', undefined])('treats VITE_APP_ENV=%p as missing', (v) => {
        expect(resolveAppEnv({ VITE_APP_ENV: v })).toEqual({
            VITE_APP_ENV: undefined,
        });
        expect(parseClientEnv({ ...BASE, VITE_APP_ENV: v }).success).toBe(
            false,
        );
    });

    it.each(['prod', 'stage'])('still requires VITE_DOMAIN in %s', (stage) => {
        const result = parseClientEnv({
            ...BASE,
            VITE_APP_ENV: stage,
            VITE_DOMAIN: '',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toContain('VITE_DOMAIN is required');
        }
    });
});
