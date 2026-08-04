import * as zod from 'zod';

export const envSchema = zod
    .object({
        VITE_NODE_ENV: zod.enum(['dev', 'prod', 'stage', 'test']),

        VITE_API_URL: zod
            .url(
                'VITE_API_URL must be a valid URL including http:// or https://',
            )
            .refine((url) => !url.endsWith('/'), {
                message: 'VITE_API_URL should not have a trailing slash',
            }),

        VITE_API_TIMEOUT: zod.coerce
            .number()
            .int('Timeout must be a whole number (milliseconds)')
            .positive('Timeout must be greater than 0')
            .max(60000, 'Timeout should not exceed 60 seconds (60000ms)'),

        VITE_DOMAIN: zod.string().trim().optional(),
    })
    .refine(
        (data) => {
            const domain = data.VITE_DOMAIN;

            if (!domain) return true;

            if (domain.startsWith('http://') || domain.startsWith('https://'))
                return false;
            if (domain.includes('/')) return false;

            return true;
        },
        {
            message:
                'VITE_DOMAIN must be a raw hostname (no http:// or slashes) when provided.',
            path: ['VITE_DOMAIN'],
        },
    );
