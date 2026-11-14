import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';

export async function components() {
    return JSON.parse(
        await readFile(new URL('../components.json', import.meta.url), 'utf8'),
    );
}

export function assertWindows11({
    platform,
    arch,
    caption,
    productType,
    build,
    cpu,
}) {
    if (
        platform !== 'win32' ||
        arch !== 'x64' ||
        productType !== 1 ||
        !/^Microsoft Windows 11\b/i.test(caption) ||
        !Number.isSafeInteger(build) ||
        build < 22000 ||
        !['GenuineIntel', 'AuthenticAMD'].includes(cpu)
    ) {
        throw new Error(
            'Proof requires actual Windows 11 Intel/AMD x64 workstation.',
        );
    }
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
