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

describe('client env: VITE_APP_ENV and the legacy VITE_NODE_ENV (#86)', () => {
    const NO_STAGE: Record<string, unknown> = { ...BASE };
    delete NO_STAGE.VITE_APP_ENV;

    it('uses VITE_APP_ENV alone, silently', () => {
        const result = parseClientEnv({ ...BASE, VITE_APP_ENV: 'stage' });
        if (!result.success) throw new Error(result.error);
        expect(result.data.VITE_APP_ENV).toBe('stage');
        expect(result.warning).toBeUndefined();
        expect(resolveAppEnv(BASE)).toEqual({ input: BASE });
    });

    it.each(['dev', 'test', 'stage', 'prod'])(
        'takes an unset VITE_APP_ENV from VITE_NODE_ENV=%s, with a warning',
        (legacy) => {
            const result = parseClientEnv({
                ...NO_STAGE,
                VITE_NODE_ENV: legacy,
            });
            if (!result.success) throw new Error(result.error);
            expect(result.data.VITE_APP_ENV).toBe(legacy);
            expect(result.data).not.toHaveProperty('VITE_NODE_ENV');
            expect(result.warning).toContain(
                `taken from VITE_NODE_ENV='${legacy}'`,
            );
            expect(result.warning).toContain(`set VITE_APP_ENV='${legacy}'`);
        },
    );

    it('treats an empty VITE_APP_ENV as unset (an unset Docker build arg)', () => {
        const result = parseClientEnv({
            ...BASE,
            VITE_APP_ENV: '',
            VITE_NODE_ENV: 'stage',
        });
        if (!result.success) throw new Error(result.error);
        expect(result.data.VITE_APP_ENV).toBe('stage');
        expect(result.warning).toContain("taken from VITE_NODE_ENV='stage'");
    });

    it('ignores an empty VITE_NODE_ENV', () => {
        const result = parseClientEnv({ ...BASE, VITE_NODE_ENV: '' });
        if (!result.success) throw new Error(result.error);
        expect(result.warning).toBeUndefined();
    });

    it('accepts both when they agree, warning to drop VITE_NODE_ENV', () => {
        const result = parseClientEnv({ ...BASE, VITE_NODE_ENV: 'prod' });
        if (!result.success) throw new Error(result.error);
        expect(result.data.VITE_APP_ENV).toBe('prod');
        expect(result.warning).toContain('VITE_NODE_ENV is deprecated');
    });

    it.each([
        ['prod', 'dev'],
        ['dev', 'prod'],
        ['stage', 'prod'],
    ])(
        'fails when VITE_APP_ENV=%s and VITE_NODE_ENV=%s disagree',
        (app, node) => {
            const result = parseClientEnv({
                ...BASE,
                VITE_APP_ENV: app,
                VITE_NODE_ENV: node,
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error).toContain(
                    `VITE_APP_ENV='${app}' and VITE_NODE_ENV='${node}' disagree`,
                );
            }
        },
    );

    it('fails without either name', () => {
        const result = parseClientEnv(NO_STAGE);
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error).toContain('VITE_APP_ENV');
    });

    it.each(['prod', 'stage'])(
        'still requires VITE_DOMAIN in %s, under either name',
        (stage) => {
            for (const name of ['VITE_APP_ENV', 'VITE_NODE_ENV']) {
                const result = parseClientEnv({
                    ...NO_STAGE,
                    [name]: stage,
                    VITE_DOMAIN: '',
                });
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(result.error).toContain('VITE_DOMAIN is required');
                }
            }
        },
    );

    it('rejects an unknown legacy value under the new name', () => {
        const result = parseClientEnv({
            ...NO_STAGE,
            VITE_NODE_ENV: 'production',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toContain('VITE_APP_ENV must be one of');
        }
    });
});
