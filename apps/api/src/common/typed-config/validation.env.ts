import * as zod from 'zod';
import { isValidTimeZone } from '../utils/timezone';
import { EAN_COUNTER } from '../../constants';

const GENERATE_SECRET_HINT = 'Generate one with: openssl rand -base64 48';

export const SECRET_MIN_LENGTH = 32;

/**
 * The exact values shipped in apps/api/.env.example. They are long enough to
 * boot in dev, so a fresh `cp .env.example .env` works, but they are public
 * and must never sign anything outside dev.
 */
export const EXAMPLE_JWT_SECRET =
    'dev-only-insecure-jwt-secret-CHANGE-ME-in-prod-0000';
export const EXAMPLE_COOKIE_SECRET =
    'dev-only-insecure-cookie-secret-CHANGE-ME-in-prod-00';

const PLACEHOLDER_PATTERN =
    /change[-_ ]?me|placeholder|replace[-_ ]?me|example|insecure|dev[-_ ]?only|your[-_ ]?secret|secret/i;

/** Minimum distinct characters, to catch 'aaaa…' or '1111…' style fillers. */
const MIN_DISTINCT_CHARS = 8;

/** True for the shipped example values and anything that reads as filler. */
export function isPlaceholderSecret(value: string): boolean {
    if (value === EXAMPLE_JWT_SECRET || value === EXAMPLE_COOKIE_SECRET) {
        return true;
    }
    if (PLACEHOLDER_PATTERN.test(value)) return true;
    return new Set(value).size < MIN_DISTINCT_CHARS;
}

const secretSchema = (name: string) =>
    zod
        .string()
        .min(
            SECRET_MIN_LENGTH,
            `${name} must be at least ${SECRET_MIN_LENGTH} characters. ${GENERATE_SECRET_HINT}`,
        );

/**
 * generate() builds prefix * 10^digits + counter, then appends one check
 * digit. For the result to be an EAN-13, prefix and counter digits together
 * must fill exactly 12 digits. Fewer makes calculateChecksum() throw on every
 * product create; more yields 14+ digits that ensureValid() rejects.
 */
export const EAN_DATA_DIGITS = 12 - String(EAN_COUNTER.PREFIX).length;

/** Sanity cap for the memory health thresholds (bytes). */
export const HEALTH_MEMORY_MAX_BYTES = 64 * 1024 ** 3; // 64 GiB

const isStrictEnv = (nodeEnv: string) =>
    nodeEnv === 'prod' || nodeEnv === 'stage';

export const envSchema = zod
    .object({
        NODE_ENV: zod.enum(['dev', 'prod', 'stage', 'test']),
        PORT: zod.coerce
            .number()
            .int('Port must be an integer')
            .min(1, 'Port must be greater than 0')
            .max(65535, 'Port must be less than or equal to 65535')
            .default(3000),
        FRONTEND_URL: zod.url(
            'Frontend URL must be a valid URL including http:// or https://',
        ),
        DATABASE_URL: zod
            .string()
            .trim()
            .regex(
                /^mongodb(\+srv)?:\/\/.+/,
                'Database URL must be a MongoDB connection string starting with mongodb:// or mongodb+srv://',
            ),
        DOMAIN: zod.string().trim().optional(),
        COOKIE_SECRET: secretSchema('COOKIE_SECRET'),
        JWT_SECRET: secretSchema('JWT_SECRET'),
        JWT_EXPIRY_S: zod.coerce.number().int().positive(),
        REFRESH_EXPIRY_S: zod.coerce.number().int().positive(),
        EAN_COUNTER_ID: zod.string(),
        EAN_COUNTER_DIGITS: zod.coerce
            .number()
            .int('EAN_COUNTER_DIGITS must be an integer')
            .positive('EAN_COUNTER_DIGITS must be positive')
            .refine((digits) => digits === EAN_DATA_DIGITS, {
                message: `EAN_COUNTER_DIGITS must be ${EAN_DATA_DIGITS}: the ${String(EAN_COUNTER.PREFIX).length}-digit prefix ${EAN_COUNTER.PREFIX} plus the counter must fill the 12 data digits of an EAN-13.`,
            }),
        SANITATION_EXCLUDES: zod
            .string()
            .transform((val) =>
                val
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
            )
            .pipe(
                zod
                    .string()
                    .array()
                    .min(1, 'At least one exclusion is required'),
            ),
        HEALTH_HEAP_THRESHOLD: zod.coerce
            .number()
            .positive()
            .max(
                HEALTH_MEMORY_MAX_BYTES,
                'HEALTH_HEAP_THRESHOLD is in bytes and must be at most 64 GiB (68719476736)',
            ),
        HEALTH_RSS_THRESHOLD: zod.coerce
            .number()
            .positive()
            .max(
                HEALTH_MEMORY_MAX_BYTES,
                'HEALTH_RSS_THRESHOLD is in bytes and must be at most 64 GiB (68719476736)',
            ),
        HEALTH_DISK_THRESHOLD_PERCENT: zod.coerce
            .number()
            .gt(0)
            .lte(1, 'Disk threshold must be a fraction between 0 and 1'),
        HEALTH_DISK_PATH: zod.string(),
        STORE_TIMEZONE: zod
            .string()
            .trim()
            .default('Asia/Manila')
            .refine(isValidTimeZone, {
                message:
                    'STORE_TIMEZONE must be a valid IANA timezone name, e.g. Asia/Manila',
            }),
    })
    .refine((data) => data.REFRESH_EXPIRY_S > data.JWT_EXPIRY_S, {
        message:
            'REFRESH_EXPIRY_S must be greater than JWT_EXPIRY_S, otherwise the refresh token expires before the access token it renews.',
        path: ['REFRESH_EXPIRY_S'],
    })
    .refine(
        (data) => {
            const domain = data.DOMAIN;
            const isLocal = data.NODE_ENV === 'dev' || data.NODE_ENV === 'test';

            if (!isLocal && !domain) {
                return false;
            }

            if (domain) {
                if (
                    domain.startsWith('http://') ||
                    domain.startsWith('https://')
                )
                    return false;
                if (domain.includes('/')) return false;
            }

            return true;
        },
        {
            message:
                'DOMAIN is required in prod/stage. It must be a raw hostname (no http:// or slashes). In dev, you can leave it blank.',
            path: ['DOMAIN'],
        },
    )
    .refine(
        (data) =>
            !isStrictEnv(data.NODE_ENV) ||
            !isPlaceholderSecret(data.JWT_SECRET),
        {
            message: `JWT_SECRET is the .env.example value or an obvious placeholder, which is not allowed in prod/stage. ${GENERATE_SECRET_HINT}`,
            path: ['JWT_SECRET'],
        },
    )
    .refine(
        (data) =>
            !isStrictEnv(data.NODE_ENV) ||
            !isPlaceholderSecret(data.COOKIE_SECRET),
        {
            message: `COOKIE_SECRET is the .env.example value or an obvious placeholder, which is not allowed in prod/stage. ${GENERATE_SECRET_HINT}`,
            path: ['COOKIE_SECRET'],
        },
    )
    // Reusing one key for both means a leak of either compromises both the
    // JWTs and the signed cookies. Dev is exempt so local setups stay simple.
    .refine(
        (data) =>
            !isStrictEnv(data.NODE_ENV) ||
            data.JWT_SECRET !== data.COOKIE_SECRET,
        {
            message: `JWT_SECRET and COOKIE_SECRET must differ in prod/stage. Generate each separately with: openssl rand -base64 48`,
            path: ['COOKIE_SECRET'],
        },
    );

export type EnvTypes = zod.infer<typeof envSchema>;
