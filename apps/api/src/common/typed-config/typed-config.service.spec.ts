import {
    DEV_ENV_WITHOUT_DOMAIN,
    validatedConfig,
} from '../testing/validated-config';
import { TypedConfigService } from './typed-config.service';
import * as zod from 'zod';
import { OPTIONAL_ENV_KEYS, optionalKeys } from './validation.env';

// What `openssl rand -base64 48` produces, so only DOMAIN can fail prod.
const PROD_SECRETS = {
    JWT_SECRET:
        'k3Jf9Qv2Lx8Zr1Tn6Wb4Yh7Pc0Md5Ea2Gs9Uq3Io8Rl1Vx6Nz4Ky7Bt0Hw5Fj2Cp',
    COOKIE_SECRET:
        'Q8wN2eR5tY1uI4oP7aS0dF3gH6jK9lZ2xC5vB8nM1qW4eR7tY0uI3oP6aS9dF2gH',
};

describe('TypedConfigService', () => {
    const savedDomain = process.env.DOMAIN;

    beforeEach(() => {
        delete process.env.DOMAIN;
    });

    afterAll(() => {
        if (savedDomain !== undefined) process.env.DOMAIN = savedDomain;
    });

    it('marks only DOMAIN optional: defaulted keys are never absent', () => {
        expect([...OPTIONAL_ENV_KEYS]).toEqual(['DOMAIN']);
    });

    it('treats a field whose probe throws as not optional, without crashing', () => {
        // Zod does not catch exceptions thrown inside a transform or refine.
        const shape = {
            PLAIN: zod.string().optional(),
            LOWER: zod
                .string()
                .optional()
                .transform((v) => (v as string).toLowerCase()),
            REFINED: zod.any().refine((v: { length: number }) => v.length > 0),
            REQUIRED: zod.string(),
            DEFAULTED: zod.string().default('x'),
        };

        expect(() => optionalKeys(shape)).not.toThrow();
        expect([...optionalKeys(shape)]).toEqual(['PLAIN']);
    });

    it.each(['dev', 'test'])(
        'boots in %s with DOMAIN unset and reads it as undefined (#91)',
        (APP_ENV) => {
            const config = validatedConfig({
                ...DEV_ENV_WITHOUT_DOMAIN,
                APP_ENV,
            });

            expect(() => config.get('DOMAIN')).not.toThrow();
            expect(config.get('DOMAIN')).toBeUndefined();
            expect(config.get('APP_ENV')).toBe(APP_ENV);
        },
    );

    it('returns a set DOMAIN, trimmed', () => {
        const config = validatedConfig({
            ...DEV_ENV_WITHOUT_DOMAIN,
            DOMAIN: ' localhost ',
        });

        expect(config.get('DOMAIN')).toBe('localhost');
    });

    it('returns schema defaults for unset keys that have one', () => {
        const config = validatedConfig(DEV_ENV_WITHOUT_DOMAIN);

        expect(config.get('PORT')).toBe(3000);
        expect(config.get('STORE_TIMEZONE')).toBe('Asia/Manila');
    });

    it('still throws for a missing required key (config never validated)', () => {
        const config = new TypedConfigService({});

        expect(() => config.get('JWT_SECRET')).toThrow(
            'Missing env variable: JWT_SECRET',
        );
    });

    describe.each(['prod', 'stage'])('in %s', (APP_ENV) => {
        const env = { ...DEV_ENV_WITHOUT_DOMAIN, ...PROD_SECRETS, APP_ENV };

        it('still refuses to boot without DOMAIN', () => {
            expect(() => validatedConfig(env)).toThrow(
                /DOMAIN is required in prod\/stage/,
            );
            expect(() => validatedConfig({ ...env, DOMAIN: '' })).toThrow(
                /DOMAIN is required in prod\/stage/,
            );
        });

        it('boots once DOMAIN is set', () => {
            const config = validatedConfig({ ...env, DOMAIN: 'example.com' });

            expect(config.get('DOMAIN')).toBe('example.com');
        });
    });
});
