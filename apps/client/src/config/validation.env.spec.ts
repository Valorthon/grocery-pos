import { describe, expect, it } from 'vitest';
import * as zod from 'zod';
import { envSchema } from './validation.env';

const BASE = {
    VITE_NODE_ENV: 'prod',
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
            issuePaths({ ...BASE, VITE_NODE_ENV: env, VITE_DOMAIN: '' }),
        ).toEqual(['VITE_DOMAIN']);
        expect(
            issuePaths({ ...BASE, VITE_NODE_ENV: env, VITE_DOMAIN: undefined }),
        ).toEqual(['VITE_DOMAIN']);
    });

    it.each(['dev', 'test'])('allows a blank VITE_DOMAIN in %s', (env) => {
        expect(
            issuePaths({ ...BASE, VITE_NODE_ENV: env, VITE_DOMAIN: '' }),
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
});
