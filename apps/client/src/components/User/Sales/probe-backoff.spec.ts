import { expect, it } from 'vitest';
import { nextProbeDelay } from './probe-backoff';

it('probes every 30 s online and every 5 s after any failures (#459)', () => {
    expect(nextProbeDelay(0)).toBe(30_000);
    for (const n of [1, 3, 10, 100]) expect(nextProbeDelay(n)).toBe(5_000);
});
