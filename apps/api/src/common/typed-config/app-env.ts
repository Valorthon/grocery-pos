/**
 * APP_ENV is the app's deployment stage (#29). NODE_ENV is left to Node,
 * Express and libraries, which key off `production`; the API image sets
 * `NODE_ENV=production`.
 *
 * Before #29 the stage lived in NODE_ENV (`dev|prod|stage|test`). For one
 * release, an unset APP_ENV is taken from such a NODE_ENV with a
 * deprecation warning.
 */
export const APP_ENVS = ['dev', 'prod', 'stage', 'test'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** Deployed over HTTPS behind Railway's proxy: prod and stage. */
export function isDeployedEnv(appEnv: string): boolean {
    return appEnv === 'prod' || appEnv === 'stage';
}

function isAppEnv(value: string): value is AppEnv {
    return (APP_ENVS as readonly string[]).includes(value);
}

export interface AppEnvResolution {
    /** The APP_ENV to validate, or undefined when none can be found. */
    appEnv?: string;
    /** A deprecation notice to log (the value is still used). */
    warning?: string;
    /** Startup must fail with this message. */
    error?: string;
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolves APP_ENV from the raw environment.
 *
 * - APP_ENV set: it wins. If NODE_ENV holds a legacy stage value
 *   (`dev|prod|stage|test`) that differs, startup fails: one of the two is
 *   stale and guessing which could run prod with dev rules. A NODE_ENV
 *   that is not a legacy stage value (`production`, `development`) never
 *   conflicts; the image always sets `production`, even for a local
 *   `APP_ENV=dev` run.
 * - A matching legacy NODE_ENV still gets a warning, because Express and
 *   libraries treat anything but `production` as development. `test` is
 *   exempt: it is also Node's own convention, and jest sets it.
 * - APP_ENV unset and NODE_ENV a legacy stage value: taken from NODE_ENV,
 *   with a deprecation warning.
 * - Otherwise APP_ENV stays unset and the schema rejects it.
 */
export function resolveAppEnv(raw: {
    APP_ENV?: unknown;
    NODE_ENV?: unknown;
}): AppEnvResolution {
    const appEnv = text(raw.APP_ENV);
    const nodeEnv = text(raw.NODE_ENV);
    const legacy = isAppEnv(nodeEnv) ? nodeEnv : undefined;

    if (appEnv) {
        if (legacy && legacy !== appEnv) {
            return {
                appEnv,
                error: `APP_ENV='${appEnv}' and NODE_ENV='${legacy}' disagree. APP_ENV is the deployment stage; set NODE_ENV to 'production' (the API image does) or remove it.`,
            };
        }
        // NODE_ENV=test is also Node's own convention (jest sets it).
        if (legacy && legacy !== 'test') {
            return {
                appEnv,
                warning: `NODE_ENV='${legacy}' is deprecated: APP_ENV now holds the deployment stage. Set NODE_ENV to 'production' in deployed environments or remove it.`,
            };
        }
        return { appEnv };
    }

    if (legacy) {
        return {
            appEnv: legacy,
            warning: `APP_ENV is unset, so it was taken from NODE_ENV='${legacy}'. This fallback is deprecated and will be removed: set APP_ENV='${legacy}' and set NODE_ENV to 'production' in deployed environments (or remove it).`,
        };
    }

    return {};
}
