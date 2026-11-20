/**
 * Terminal clock correction for offline cash (#398). A LAN terminal's clock
 * may differ from the main PC's; the server sends its `serverTime` (epoch ms)
 * with the lease and every catalogue page, and the terminal uses
 * `Date.now() + offset` for readiness, enqueue checks and `soldAt`.
 */

/** Above this offset (ms) the terminal warns that its clock is wrong. */
export const OFFLINE_CLOCK_WARN_MS = 30_000;

/**
 * Server minus local clock, in ms, assuming the server answered halfway
 * through the round trip (`sentAt`..`receivedAt`, both local epoch ms).
 */
export function offlineClockOffset(
    sentAt: number,
    receivedAt: number,
    serverTime: number,
): number {
    return Math.round(serverTime - (sentAt + receivedAt) / 2);
}

/**
 * The `soldAt` (epoch ms) to send for an offline sale: the corrected clock,
 * never earlier than the lease issue time or any line proof's signed `iat`
 * (whole seconds), so a residual offset cannot make the server refuse it.
 */
export function offlineSoldAtMs(
    correctedNow: number,
    leaseIssuedAt: string,
    proofIats: readonly number[],
): number {
    return Math.max(
        Math.round(correctedNow),
        Date.parse(leaseIssuedAt),
        ...proofIats.map((iat) => iat * 1000),
    );
}
