import * as zod from 'zod';

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
        DATABASE_URL: zod.url(
            'Database URL must be a valid URL including http:// or https://',
        ),
        DOMAIN: zod.string().trim().optional(),
        COOKIE_SECRET: zod.string(),
        JWT_SECRET: zod.string(),
        JWT_EXPIRY: zod.coerce.number().positive(),
        REFRESH_EXPIRY: zod.coerce.number().positive(),
        EAN_COUNTER_ID: zod.string(),
        EAN_COUNTER_DIGITS: zod.coerce.number(),
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
        HEALTH_HEAP_THRESHOLD: zod.coerce.number().positive(),
        HEALTH_RSS_THRESHOLD: zod.coerce.number().positive(),
        HEALTH_DISK_THRESHOLD: zod.coerce.number().positive(),
        HEALTH_DISK_PATH: zod.string(),
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
    );

export type EnvTypes = zod.infer<typeof envSchema>;
