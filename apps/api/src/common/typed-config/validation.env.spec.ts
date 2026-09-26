import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import {
    envSchema,
    EXAMPLE_COOKIE_SECRET,
    EXAMPLE_JWT_SECRET,
    SECRET_MIN_LENGTH,
    validateEnv,
} from './validation.env';

// What `openssl rand -base64 48` produces: 64 chars, high entropy.
const REAL_JWT_SECRET =
    'k3Jf9Qv2Lx8Zr1Tn6Wb4Yh7Pc0Md5Ea2Gs9Uq3Io8Rl1Vx6Nz4Ky7Bt0Hw5Fj2Cp';
const REAL_COOKIE_SECRET =
    'Q8wN2eR5tY1uI4oP7aS0dF3gH6jK9lZ2xC5vB8nM1qW4eR7tY0uI3oP6aS9dF2gH';

const BASE_ENV = {
    APP_ENV: 'test',
    FRONTEND_URL: 'http://localhost:5173',
    DATABASE_URL: 'mongodb://127.0.0.1:27017/grocery',
    COOKIE_SECRET: EXAMPLE_COOKIE_SECRET,
    JWT_SECRET: EXAMPLE_JWT_SECRET,
    JWT_EXPIRY_S: '900',
    REFRESH_EXPIRY_S: '604800',
    EAN_COUNTER_ID: 'EAN_COUNTER_ID',
    EAN_COUNTER_DIGITS: '9',
    HEALTH_HEAP_THRESHOLD: '1',
    HEALTH_RSS_THRESHOLD: '1',
    HEALTH_DISK_THRESHOLD_PERCENT: '0.9',
    HEALTH_DISK_PATH: '/',
};

const PROD_ENV = {
    ...BASE_ENV,
    APP_ENV: 'prod',
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

describe('envSchema leftovers', () => {
    it('ignores a leftover SANITATION_EXCLUDES instead of failing startup (#15)', () => {
        const result = envSchema.safeParse({
            ...BASE_ENV,
            SANITATION_EXCLUDES: 'password',
        });

        expect(result.success).toBe(true);
        expect(result.data).not.toHaveProperty('SANITATION_EXCLUDES');
    });
});

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
            (appEnv) => {
                const env = {
                    ...PROD_ENV,
                    APP_ENV: appEnv,
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
                envSchema.safeParse({ ...BASE_ENV, APP_ENV: 'dev' }).success,
            ).toBe(true);
            expect(envSchema.safeParse(BASE_ENV).success).toBe(true);
        });

        it.each(['prod', 'stage'])(
            'rejects the .env.example placeholder in %s',
            (appEnv) => {
                const placeholder =
                    key === 'JWT_SECRET'
                        ? EXAMPLE_JWT_SECRET
                        : EXAMPLE_COOKIE_SECRET;
                const env = {
                    ...PROD_ENV,
                    APP_ENV: appEnv,
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
        (appEnv) => {
            const env = {
                ...PROD_ENV,
                APP_ENV: appEnv,
                COOKIE_SECRET: REAL_JWT_SECRET,
            };

            expect(issuePaths(env)).toEqual(['COOKIE_SECRET']);
            expect(issueMessages(env)[0]).toContain('openssl rand -base64 48');
        },
    );

    it('allows identical secrets in dev', () => {
        const env = {
            ...BASE_ENV,
            APP_ENV: 'dev',
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

    it.each([
        ['apps/api', '../../../.env.example'],
        ['apps/client', '../../../../client/.env.example'],
    ])(
        '%s/.env.example also works with docker run --env-file (#29)',
        (_app, path) => {
            // Docker passes everything after `=` verbatim: an inline comment
            // or quotes would end up in the value.
            const lines = readFileSync(join(__dirname, path), 'utf8')
                .split('\n')
                .filter((line) => line.trim() && !line.startsWith('#'));
            expect(lines.length).toBeGreaterThan(3);
            for (const line of lines) {
                expect(line).toMatch(/^[A-Z][A-Z0-9_]*=[^\s#'"]*$/);
            }
        },
    );

    it("reads DOMAIN= as blank, as the old DOMAIN='' was", () => {
        expect(example.DOMAIN).toBe('');
        expect(parseDotenv("DOMAIN=''").DOMAIN).toBe('');
    });

    it('ships the placeholders the schema knows about', () => {
        expect(example.JWT_SECRET).toBe(EXAMPLE_JWT_SECRET);
        expect(example.COOKIE_SECRET).toBe(EXAMPLE_COOKIE_SECRET);
    });

    it('is rejected in prod until both secrets are replaced', () => {
        const env = { ...example, APP_ENV: 'prod', DOMAIN: 'example.com' };

        expect(issuePaths(env).sort()).toEqual(['COOKIE_SECRET', 'JWT_SECRET']);
    });
});

describe('envSchema REFRESH_EXPIRY_S vs JWT_EXPIRY_S', () => {
    it('rejects a refresh token that dies before (or with) the access token it renews', () => {
        // The session could never be renewed: every refresh would come
        // after the refresh token had already expired.
        for (const REFRESH_EXPIRY_S of ['900', '600']) {
            expect(
                issuePaths({
                    ...BASE_ENV,
                    JWT_EXPIRY_S: '900',
                    REFRESH_EXPIRY_S,
                }),
            ).toContain('REFRESH_EXPIRY_S');
        }
    });

    it('accepts a refresh expiry longer than the access expiry', () => {
        expect(
            issuePaths({
                ...BASE_ENV,
                JWT_EXPIRY_S: '900',
                REFRESH_EXPIRY_S: '901',
            }),
        ).toEqual([]);
    });
});

describe('envSchema.DOMAIN', () => {
    // The cookie domain (CookieService). A scheme or a path makes the
    // browser reject every cookie, so the app would boot and then fail
    // every login.
    it.each(['prod', 'stage'])('is required in %s', (APP_ENV) => {
        const env: Record<string, unknown> = { ...PROD_ENV, APP_ENV };
        delete env.DOMAIN;
        expect(issuePaths(env)).toContain('DOMAIN');
        expect(issuePaths({ ...env, DOMAIN: '' })).toContain('DOMAIN');
    });

    it.each(['dev', 'test'])('may be left blank in %s', (APP_ENV) => {
        expect(issuePaths({ ...BASE_ENV, APP_ENV, DOMAIN: '' })).toEqual([]);
        expect(issuePaths({ ...BASE_ENV, APP_ENV })).toEqual([]);
    });

    it.each(['https://example.com', 'http://example.com', 'example.com/api'])(
        'rejects %s: a raw hostname only, in every environment',
        (DOMAIN) => {
            expect(issuePaths({ ...PROD_ENV, DOMAIN })).toContain('DOMAIN');
            expect(issuePaths({ ...BASE_ENV, DOMAIN })).toContain('DOMAIN');
        },
    );

    it('accepts a raw hostname or a leading-dot parent domain', () => {
        expect(issuePaths({ ...PROD_ENV, DOMAIN: 'example.com' })).toEqual([]);
        expect(issuePaths({ ...PROD_ENV, DOMAIN: '.example.com' })).toEqual([]);
    });
});

describe('envSchema.APP_ENV', () => {
    it.each(['dev', 'prod', 'stage', 'test'])('accepts %s', (APP_ENV) => {
        const env =
            APP_ENV === 'dev' || APP_ENV === 'test' ? BASE_ENV : PROD_ENV;
        expect(envSchema.parse({ ...env, APP_ENV }).APP_ENV).toBe(APP_ENV);
    });

    it.each(['production', 'development', 'PROD', '', undefined])(
        'rejects %p with a message naming APP_ENV',
        (APP_ENV) => {
            const env = { ...BASE_ENV, APP_ENV };
            expect(issuePaths(env)).toEqual(['APP_ENV']);
            expect(issueMessages(env)[0]).toContain('APP_ENV must be one of');
        },
    );

    it('drops NODE_ENV from the parsed config: it belongs to Node', () => {
        const parsed = envSchema.parse({ ...BASE_ENV, NODE_ENV: 'production' });
        expect(parsed).not.toHaveProperty('NODE_ENV');
    });
});

describe('validateEnv', () => {
    const withoutAppEnv = (env: Record<string, unknown>) =>
        Object.fromEntries(
            Object.entries(env).filter(([key]) => key !== 'APP_ENV'),
        );
    const NO_APP_ENV = withoutAppEnv(PROD_ENV);

    function run(env: Record<string, unknown>) {
        const warnings: string[] = [];
        const parsed = validateEnv(env, (m) => warnings.push(m));
        return { parsed, warnings };
    }

    it('uses APP_ENV beside the image NODE_ENV=production, silently', () => {
        const { parsed, warnings } = run({
            ...PROD_ENV,
            NODE_ENV: 'production',
        });
        expect(parsed.APP_ENV).toBe('prod');
        expect(warnings).toEqual([]);
    });

    it('allows a local APP_ENV=dev run of the image (NODE_ENV=production)', () => {
        const { parsed, warnings } = run({
            ...BASE_ENV,
            APP_ENV: 'dev',
            NODE_ENV: 'production',
        });
        expect(parsed.APP_ENV).toBe('dev');
        expect(warnings).toEqual([]);
    });

    it.each(['prod', 'stage', 'dev', 'test'])(
        'takes an unset APP_ENV from the legacy NODE_ENV=%s, with a deprecation warning',
        (legacy) => {
            const env = withoutAppEnv(
                legacy === 'dev' || legacy === 'test' ? BASE_ENV : PROD_ENV,
            );
            const { parsed, warnings } = run({ ...env, NODE_ENV: legacy });
            expect(parsed.APP_ENV).toBe(legacy);
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain('deprecated');
            expect(warnings[0]).toContain(`APP_ENV='${legacy}'`);
        },
    );

    it('treats a blank APP_ENV as unset', () => {
        const { parsed, warnings } = run({
            ...PROD_ENV,
            APP_ENV: '  ',
            NODE_ENV: 'stage',
        });
        expect(parsed.APP_ENV).toBe('stage');
        expect(warnings).toHaveLength(1);
    });

    it('keeps the prod rules when the stage comes from the legacy NODE_ENV', () => {
        expect(() =>
            run({ ...NO_APP_ENV, NODE_ENV: 'prod', DOMAIN: '' }),
        ).toThrow('DOMAIN');
    });

    it.each([
        ['prod', 'dev'],
        ['prod', 'stage'],
        ['stage', 'prod'],
        ['dev', 'prod'],
        ['prod', 'test'],
    ])('fails fast when APP_ENV=%s and NODE_ENV=%s disagree', (app, node) => {
        const warn = jest.fn();
        expect(() =>
            validateEnv({ ...PROD_ENV, APP_ENV: app, NODE_ENV: node }, warn),
        ).toThrow(`APP_ENV='${app}' and NODE_ENV='${node}' disagree`);
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns when a legacy NODE_ENV agrees with APP_ENV', () => {
        const { parsed, warnings } = run({ ...PROD_ENV, NODE_ENV: 'prod' });
        expect(parsed.APP_ENV).toBe('prod');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("NODE_ENV='prod' is deprecated");
    });

    it("stays silent for NODE_ENV=test with APP_ENV=test (jest's own value)", () => {
        const { warnings } = run({ ...BASE_ENV, NODE_ENV: 'test' });
        expect(warnings).toEqual([]);
    });

    it('fails when neither names a stage', () => {
        expect(() => run({ ...NO_APP_ENV, NODE_ENV: 'production' })).toThrow(
            'APP_ENV must be one of',
        );
        expect(() => run(NO_APP_ENV)).toThrow('APP_ENV must be one of');
    });

    it('rejects an unknown APP_ENV even beside a legacy NODE_ENV', () => {
        expect(() =>
            run({ ...PROD_ENV, APP_ENV: 'production', NODE_ENV: 'production' }),
        ).toThrow('APP_ENV must be one of');
    });
});
