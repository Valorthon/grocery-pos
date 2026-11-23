/** Normal cadence of the offline status health probe (#459). */
export const PROBE_INTERVAL_MS = 30_000;
/** Retries after consecutive failed probes, then PROBE_INTERVAL_MS (#459). */
export const PROBE_BACKOFF_MS = [2_000, 5_000, 10_000] as const;

/** Delay before the next probe after `failures` consecutive failed ones. */
export function nextProbeDelay(failures: number): number {
    return failures > 0
        ? (PROBE_BACKOFF_MS[failures - 1] ?? PROBE_INTERVAL_MS)
        : PROBE_INTERVAL_MS;
}
