import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';

export async function components() {
    return JSON.parse(
        await readFile(new URL('../components.json', import.meta.url), 'utf8'),
    );
}

/** Windows 10 is accepted from build 10240; 19045 is 22H2, the last. */
export const WINDOWS_10_MIN_BUILD = 10240;
export const WINDOWS_10_22H2_BUILD = 19045;
export const WINDOWS_11_MIN_BUILD = 22000;

/**
 * Refuses anything but a Windows 10 or Windows 11 client edition on
 * Intel/AMD x64 (owner decision 2026-11-24). Returns the warnings to record:
 * Windows 10 below 22H2, and AVX support unknown. AVX known absent refuses.
 */
export function assertSupportedWindows({
    platform,
    arch,
    caption,
    productType,
    build,
    cpu,
    avx,
}) {
    const refuse = (why) => {
        throw new Error(
            `Proof requires actual Windows 10 or Windows 11 Intel/AMD x64 workstation${why ? ` (${why})` : ''}.`,
        );
    };
    if (
        platform !== 'win32' ||
        arch !== 'x64' ||
        productType !== 1 ||
        !Number.isSafeInteger(build) ||
        !['GenuineIntel', 'AuthenticAMD'].includes(cpu)
    )
        refuse();
    const major = /^Microsoft Windows (10|11)\b/i.exec(caption ?? '')?.[1];
    if (
        major === '11'
            ? build < WINDOWS_11_MIN_BUILD
            : major === '10'
              ? build < WINDOWS_10_MIN_BUILD || build > WINDOWS_10_22H2_BUILD
              : true
    )
        refuse();
    if (avx === false) refuse('the CPU has no AVX');
    const warnings = [];
    if (major === '10' && build < WINDOWS_10_22H2_BUILD)
        warnings.push(
            `Windows 10 build ${build} is not 22H2 (${WINDOWS_10_22H2_BUILD})`,
        );
    if (avx !== true) warnings.push('CPU AVX support could not be read');
    return {
        windows10_22H2: major === '10' ? build >= WINDOWS_10_22H2_BUILD : null,
        warnings,
    };
}

export function parseArgs(args) {
    const names = ['api', 'node-archive', 'mongo-archive', 'output', 'commit'];
    const result = {};
    for (let i = 0; i < args.length; i += 2) {
        const name = args[i]?.slice(2);
        if (
            !args[i]?.startsWith('--') ||
            !names.includes(name) ||
            !args[i + 1] ||
            args[i + 1].startsWith('--') ||
            Object.hasOwn(result, name)
        ) {
            throw new Error(
                'Expected each documented proof option exactly once.',
            );
        }
        result[name] = args[i + 1];
    }
    if (
        names.some((name) => !result[name]) ||
        !/^[a-f0-9]{40}$/.test(result.commit)
    ) {
        throw new Error(
            'All proof options and a full source commit are required.',
        );
    }
    return result;
}

export async function sha256(path) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
}

export async function verifyArchive(path, expected) {
    if (!/^[a-f0-9]{64}$/.test(expected) || (await sha256(path)) !== expected) {
        throw new Error('Component archive checksum mismatch.');
    }
}

export async function boundedWait(
    check,
    { timeoutMs = 60000, intervalMs = 250 } = {},
) {
    const end = performance.now() + timeoutMs;
    while (performance.now() < end) {
        let timer;
        try {
            const ready = await Promise.race([
                check(),
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                new Error('Proof readiness deadline exceeded.'),
                            ),
                        Math.max(1, end - performance.now()),
                    );
                }),
            ]);
            if (ready) return;
        } finally {
            clearTimeout(timer);
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('Proof readiness deadline exceeded.');
}
