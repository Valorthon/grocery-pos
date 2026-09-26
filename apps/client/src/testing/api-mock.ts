/**
 * Types for the `@/axios` doubles in view specs (issue #27), so a spec
 * reads its recorded calls without `any`:
 *
 *     const api = vi.hoisted(() => ({ get: vi.fn<ApiGet>() }));
 *     api.get.mock.calls.map(([, config]) => config?.params);
 */

/** The request config the views pass: only `params` is ever read back. */
export interface ApiRequestConfig {
    params?: Record<string, unknown>;
}

/** `api.get(url, config)`, resolving to an axios-like `{ data }`. */
export type ApiGet = (
    url: string,
    config?: ApiRequestConfig,
) => Promise<{ data: unknown }>;

/** `api.post(url, body, config)` / `api.patch(...)`. */
export type ApiSend = (
    url: string,
    body?: unknown,
    config?: ApiRequestConfig,
) => Promise<{ data: unknown }>;
