/** Normal cadence of the offline status health probe (#459). */
export const PROBE_INTERVAL_MS = 30_000;
/** Flat retry delay while the API does not answer (#459, owner 2026-11-23). */
export const PROBE_RETRY_MS = 5_000;

/** Delay before the next probe after `failures` consecutive failed ones. */
export function nextProbeDelay(failures: number): number {
    return failures > 0 ? PROBE_RETRY_MS : PROBE_INTERVAL_MS;
}
