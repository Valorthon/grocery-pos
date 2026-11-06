import * as zod from 'zod';

// No `new Function` probe: zod's JIT check trips the nginx CSP (script-src
// 'self', no 'unsafe-eval') on every load, even though it catches the error
// (#29). The env schema is parsed once, so the JIT gains nothing here.
zod.config({ jitless: true });

/** The client's deployment stage, the same values as the API's APP_ENV. */
export const CLIENT_APP_ENVS = ['dev', 'prod', 'stage', 'test'] as const;

export const envSchema = zod
    .object({
        VITE_APP_ENV: zod.enum(CLIENT_APP_ENVS, {
            error: `VITE_APP_ENV must be one of ${CLIENT_APP_ENVS.join(', ')}`,
        }),

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
            const isLocal =
                data.VITE_APP_ENV === 'dev' || data.VITE_APP_ENV === 'test';

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
                'VITE_DOMAIN is required in prod/stage. It must be a raw hostname (no http:// or slashes). In dev, you can leave it blank.',
            path: ['VITE_DOMAIN'],
        },
    );

export type ClientEnv = zod.infer<typeof envSchema>;

type RawEnv = Record<string, unknown>;

function text(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
}

/**
 * VITE_APP_ENV is the client's stage (#86), trimmed before the schema sees
 * it; an empty string counts as unset (Docker passes unset build args as '').
 * The old name VITE_NODE_ENV is no longer read: on its own it fails the
 * schema like any missing VITE_APP_ENV.
 */
export function resolveAppEnv(raw: RawEnv): RawEnv {
    return { ...raw, VITE_APP_ENV: text(raw.VITE_APP_ENV) };
}

export type ClientEnvResult =
    { success: true; data: ClientEnv } | { success: false; error: string };

/** Resolves the stage (see resolveAppEnv), then validates with envSchema. */
export function parseClientEnv(raw: RawEnv): ClientEnvResult {
    const result = envSchema.safeParse(resolveAppEnv(raw));
    if (!result.success) {
        return {
            success: false,
            error: JSON.stringify(zod.treeifyError(result.error), null, 2),
        };
    }
    return { success: true, data: result.data };
}
