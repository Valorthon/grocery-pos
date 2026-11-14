import * as zod from 'zod';

// No `new Function` probe: zod's JIT check trips the nginx CSP (script-src
// 'self', no 'unsafe-eval') on every load, even though it catches the error
// (#29). The env schema is parsed once, so the JIT gains nothing here.
zod.config({ jitless: true });

/** The client's deployment stage, the same values as the API's APP_ENV. */
export const CLIENT_APP_ENVS = [
    'dev',
    'prod',
    'stage',
    'test',
    'single-pc',
] as const;

/**
 * The single-pc edition's API base (#358): same-origin, relative. The
 * local HTTPS proxy at `https://localhost:1443` serves the bundle and
 * forwards `/v1/*` to the loopback API, so the bundle needs no host name.
 */
export const SINGLE_PC_API_URL = '/v1';

export const envSchema = zod
    .object({
        VITE_APP_ENV: zod.enum(CLIENT_APP_ENVS, {
            error: `VITE_APP_ENV must be one of ${CLIENT_APP_ENVS.join(', ')}`,
        }),

        // Checked against VITE_APP_ENV below: an absolute URL, except
        // single-pc's relative SINGLE_PC_API_URL.
        VITE_API_URL: zod.string().trim(),

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
                data.VITE_APP_ENV === 'dev' ||
                data.VITE_APP_ENV === 'test' ||
                data.VITE_APP_ENV === 'single-pc';

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
    )
    // single-pc's session marker is host-only, like its cookies.
    .refine((data) => data.VITE_APP_ENV !== 'single-pc' || !data.VITE_DOMAIN, {
        message:
            'VITE_DOMAIN must be blank in single-pc: its cookies are host-only.',
        path: ['VITE_DOMAIN'],
    })
    .superRefine((data, ctx) => {
        const message = apiUrlProblem(data.VITE_APP_ENV, data.VITE_API_URL);
        if (message)
            ctx.addIssue({ code: 'custom', message, path: ['VITE_API_URL'] });
    });

/** Why VITE_API_URL does not suit the stage, or null. */
function apiUrlProblem(appEnv: string, apiUrl: string): string | null {
    if (appEnv === 'single-pc') {
        return apiUrl === SINGLE_PC_API_URL
            ? null
            : `VITE_API_URL must be ${SINGLE_PC_API_URL} in single-pc: the API is same-origin behind the local proxy.`;
    }
    if (!/^https?:\/\//.test(apiUrl) || !URL.canParse(apiUrl)) {
        return 'VITE_API_URL must be a valid URL including http:// or https://';
    }
    if (apiUrl.endsWith('/')) {
        return 'VITE_API_URL should not have a trailing slash';
    }
    return null;
}

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
