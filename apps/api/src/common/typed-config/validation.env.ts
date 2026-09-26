import * as zod from 'zod';
import { isValidTimeZone } from '../utils/timezone';
import { EAN_COUNTER } from '../../constants';
import { APP_ENVS, isDeployedEnv, resolveAppEnv } from './app-env';

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
 * must fill exactly 12 digits, or generate() throws (its length guard) on
 * every product create. Generated codes are the reserved range that typed
 * barcodes may not use (`isReservedBarcode` in @grocery-pos/contracts).
 */
export const EAN_DATA_DIGITS = 12 - String(EAN_COUNTER.PREFIX).length;

/** Sanity cap for the memory health thresholds (bytes). */
export const HEALTH_MEMORY_MAX_BYTES = 64 * 1024 ** 3; // 64 GiB

export const envSchema = zod
    .object({
        APP_ENV: zod.enum(APP_ENVS, {
            error: `APP_ENV must be one of ${APP_ENVS.join(', ')} (the deployment stage; NODE_ENV is for Node itself).`,
        }),
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
            if (isDeployedEnv(data.APP_ENV) && !domain) {
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
            !isDeployedEnv(data.APP_ENV) ||
            !isPlaceholderSecret(data.JWT_SECRET),
        {
            message: `JWT_SECRET is the .env.example value or an obvious placeholder, which is not allowed in prod/stage. ${GENERATE_SECRET_HINT}`,
            path: ['JWT_SECRET'],
        },
    )
    .refine(
        (data) =>
            !isDeployedEnv(data.APP_ENV) ||
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
            !isDeployedEnv(data.APP_ENV) ||
            data.JWT_SECRET !== data.COOKIE_SECRET,
        {
            message: `JWT_SECRET and COOKIE_SECRET must differ in prod/stage. Generate each separately with: openssl rand -base64 48`,
            path: ['COOKIE_SECRET'],
        },
    );

export type EnvTypes = zod.infer<typeof envSchema>;

/**
 * Keys of `shape` that may be absent after validation: `undefined` parses
 * and stays `undefined` (not replaced by a default). A probe that throws
 * (a refine or transform that assumes a string) counts as not optional, so
 * the import never crashes and `get` keeps failing loudly for that key.
 */
export function optionalKeys<Key extends string>(
    shape: Record<Key, zod.ZodType>,
): Set<Key> {
    return new Set(
        (Object.keys(shape) as Key[]).filter((key) => {
            try {
                const result = shape[key].safeParse(undefined);
                return result.success && result.data === undefined;
            } catch {
                return false;
            }
        }),
    );
}

/**
 * Today that is DOMAIN, which only prod and stage require (#91).
 * TypedConfigService.get returns `undefined` for these instead of throwing.
 * A permissive field such as `zod.any()` would also land here; the spec
 * pins the set.
 */
export const OPTIONAL_ENV_KEYS: ReadonlySet<keyof EnvTypes> = optionalKeys(
    envSchema.shape,
);

/**
 * What ConfigModule validates: resolves APP_ENV (with the NODE_ENV
 * transition in app-env.ts), then parses. Throws on any problem; `warn`
 * receives deprecation notices.
 */
export function validateEnv(
    config: Record<string, unknown>,
    warn: (message: string) => void,
): EnvTypes {
    const { appEnv, warning, error } = resolveAppEnv(config);
    if (error) throw new Error(`Invalid env variable: ${error}`);
    if (warning) warn(warning);

    const parsed = envSchema.safeParse({ ...config, APP_ENV: appEnv });
    if (!parsed.success) {
        throw new Error(
            'Invalid env variable: ' +
                JSON.stringify(parsed.error.issues, null, 2),
        );
    }
    return parsed.data;
}
