import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import {
    envSchema,
    EXAMPLE_COOKIE_SECRET,
    EXAMPLE_JWT_SECRET,
    SECRET_MIN_LENGTH,
} from './validation.env';

// What `openssl rand -base64 48` produces: 64 chars, high entropy.
const REAL_JWT_SECRET =
    'k3Jf9Qv2Lx8Zr1Tn6Wb4Yh7Pc0Md5Ea2Gs9Uq3Io8Rl1Vx6Nz4Ky7Bt0Hw5Fj2Cp';
const REAL_COOKIE_SECRET =
    'Q8wN2eR5tY1uI4oP7aS0dF3gH6jK9lZ2xC5vB8nM1qW4eR7tY0uI3oP6aS9dF2gH';

const BASE_ENV = {
    NODE_ENV: 'test',
    FRONTEND_URL: 'http://localhost:5173',
    DATABASE_URL: 'mongodb://127.0.0.1:27017/grocery',
    COOKIE_SECRET: EXAMPLE_COOKIE_SECRET,
    JWT_SECRET: EXAMPLE_JWT_SECRET,
    JWT_EXPIRY_S: '900',
    REFRESH_EXPIRY_S: '604800',
    EAN_COUNTER_ID: 'EAN_COUNTER_ID',
    EAN_COUNTER_DIGITS: '9',
    SANITATION_EXCLUDES: 'password',
    HEALTH_HEAP_THRESHOLD: '1',
    HEALTH_RSS_THRESHOLD: '1',
    HEALTH_DISK_THRESHOLD_PERCENT: '0.9',
    HEALTH_DISK_PATH: '/',
};

const PROD_ENV = {
    ...BASE_ENV,
    NODE_ENV: 'prod',
    DOMAIN: 'example.com',
    JWT_SECRET: REAL_JWT_SECRET,
    COOKIE_SECRET: REAL_COOKIE_SECRET,
};

function issuePaths(env: Record<string, unknown>): string[] {
    const result = envSchema.safeParse(env);
    return (result.error?.issues ?? []).map((i) => i.path.join('.'));
}

function issueMessages(env: Record<string, unknown>): string[] {
    const result = envSchema.safeParse(env);
    return (result.error?.issues ?? []).map((i) => i.message);
}

describe('envSchema.STORE_TIMEZONE', () => {
    it('defaults to Asia/Manila', () => {
        const parsed = envSchema.parse(BASE_ENV);

        expect(parsed.STORE_TIMEZONE).toBe('Asia/Manila');
    });

    it('accepts another IANA zone', () => {
        const parsed = envSchema.parse({
            ...BASE_ENV,
            STORE_TIMEZONE: 'America/New_York',
        });

        expect(parsed.STORE_TIMEZONE).toBe('America/New_York');
    });

    it('rejects an unknown zone', () => {
        const result = envSchema.safeParse({
            ...BASE_ENV,
            STORE_TIMEZONE: 'Asia/Atlantis',
        });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(['STORE_TIMEZONE']);
    });
});

describe.each(['JWT_SECRET', 'COOKIE_SECRET'] as const)(
    'envSchema.%s',
    (key) => {
        it.each(['dev', 'test', 'prod', 'stage'])(
            'rejects a secret shorter than 32 chars in %s',
            (nodeEnv) => {
                const env = {
                    ...PROD_ENV,
                    NODE_ENV: nodeEnv,
                    [key]: 'x'.repeat(SECRET_MIN_LENGTH - 1),
                };

                expect(issuePaths(env)).toContain(key);
                expect(issueMessages(env).join('\n')).toContain(
                    'openssl rand -base64 48',
                );
            },
        );

        it('rejects an empty secret', () => {
            expect(issuePaths({ ...BASE_ENV, [key]: '' })).toContain(key);
        });

        it('accepts the .env.example placeholder in dev and test', () => {
            expect(
                envSchema.safeParse({ ...BASE_ENV, NODE_ENV: 'dev' }).success,
            ).toBe(true);
            expect(envSchema.safeParse(BASE_ENV).success).toBe(true);
        });

        it.each(['prod', 'stage'])(
            'rejects the .env.example placeholder in %s',
            (nodeEnv) => {
                const placeholder =
                    key === 'JWT_SECRET'
                        ? EXAMPLE_JWT_SECRET
                        : EXAMPLE_COOKIE_SECRET;
                const env = {
                    ...PROD_ENV,
                    NODE_ENV: nodeEnv,
                    [key]: placeholder,
                };

                expect(issuePaths(env)).toEqual([key]);
                expect(issueMessages(env)[0]).toContain(
                    'openssl rand -base64 48',
                );
            },
        );

        it.each([
            'changeme-changeme-changeme-changeme',
            'REPLACE_ME_WITH_A_REAL_SECRET_VALUE_PLEASE',
            'my-super-secret-production-key-1234567890',
            'a'.repeat(64),
            '0123012301230123012301230123012301230123',
        ])('rejects the obvious placeholder %p in prod', (value) => {
            expect(issuePaths({ ...PROD_ENV, [key]: value })).toEqual([key]);
        });

        it('accepts a generated 32+ char secret in prod', () => {
            const parsed = envSchema.parse(PROD_ENV);

            expect(parsed[key]).toBe(
                key === 'JWT_SECRET' ? REAL_JWT_SECRET : REAL_COOKIE_SECRET,
            );
        });
    },
);

describe('envSchema identical secrets', () => {
    it.each(['prod', 'stage'])(
        'rejects JWT_SECRET === COOKIE_SECRET in %s',
        (nodeEnv) => {
            const env = {
                ...PROD_ENV,
                NODE_ENV: nodeEnv,
                COOKIE_SECRET: REAL_JWT_SECRET,
            };

            expect(issuePaths(env)).toEqual(['COOKIE_SECRET']);
            expect(issueMessages(env)[0]).toContain('openssl rand -base64 48');
        },
    );

    it('allows identical secrets in dev', () => {
        const env = {
            ...BASE_ENV,
            NODE_ENV: 'dev',
            JWT_SECRET: REAL_JWT_SECRET,
            COOKIE_SECRET: REAL_JWT_SECRET,
        };

        expect(envSchema.safeParse(env).success).toBe(true);
    });
});

describe('envSchema.EAN_COUNTER_DIGITS', () => {
    it('accepts 9 (3-digit prefix + 9 + check digit = EAN-13)', () => {
        expect(envSchema.parse(BASE_ENV).EAN_COUNTER_DIGITS).toBe(9);
    });

    it.each(['9.5', '-9', '0', '8', '10', 'abc'])('rejects %p', (value) => {
        expect(
            issuePaths({ ...BASE_ENV, EAN_COUNTER_DIGITS: value }),
        ).toContain('EAN_COUNTER_DIGITS');
    });
});

describe.each(['HEALTH_HEAP_THRESHOLD', 'HEALTH_RSS_THRESHOLD'] as const)(
    'envSchema.%s',
    (key) => {
        it('accepts 150 MiB', () => {
            expect(
                envSchema.parse({ ...BASE_ENV, [key]: '157286400' })[key],
            ).toBe(157286400);
        });

        it('accepts exactly 64 GiB', () => {
            expect(
                envSchema.safeParse({
                    ...BASE_ENV,
                    [key]: String(64 * 1024 ** 3),
                }).success,
            ).toBe(true);
        });

        it.each([
            String(64 * 1024 ** 3 + 1),
            '1572864001572864001572864001572864001572',
        ])('rejects the absurd value %p', (value) => {
            expect(issuePaths({ ...BASE_ENV, [key]: value })).toEqual([key]);
        });
    },
);

describe('apps/api/.env.example', () => {
    const example = parseDotenv(
        readFileSync(join(__dirname, '../../../.env.example')),
    );

    it('boots in dev as shipped', () => {
        const result = envSchema.safeParse(example);

        expect(result.error?.issues).toBeUndefined();
        expect(result.success).toBe(true);
    });

    it('ships the placeholders the schema knows about', () => {
        expect(example.JWT_SECRET).toBe(EXAMPLE_JWT_SECRET);
        expect(example.COOKIE_SECRET).toBe(EXAMPLE_COOKIE_SECRET);
    });

    it('is rejected in prod until both secrets are replaced', () => {
        const env = { ...example, NODE_ENV: 'prod', DOMAIN: 'example.com' };

        expect(issuePaths(env).sort()).toEqual(['COOKIE_SECRET', 'JWT_SECRET']);
    });
});
