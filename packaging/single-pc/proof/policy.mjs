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
 * PowerShell that prints whether the CPU has AVX
 * (IsProcessorFeaturePresent(PF_AVX_INSTRUCTIONS_AVAILABLE = 39)); [char]34
 * avoids quoting issues. Shared by the acceptance harness, the installer and
 * diagnostics (#489).
 */
export const AVX_PROBE_COMMAND =
    "Add-Type -Namespace Gpos -Name Cpu -MemberDefinition ('[DllImport(' + [char]34 + 'kernel32.dll' + [char]34 + ')] public static extern bool IsProcessorFeaturePresent(uint f);'); [Gpos.Cpu]::IsProcessorFeaturePresent(39)";

/** true/false from the probe's exit code and output, null when unreadable. */
export function parseAvxProbe({ code, stdout } = {}) {
    if (code !== 0) return null;
    const text = String(stdout ?? '').trim();
    if (/^true$/i.test(text)) return true;
    if (/^false$/i.test(text)) return false;
    return null;
}

/**
 * The one Windows edition/build/AVX rule set (owner decision 2026-11-24),
 * shared by the proof guard and the acceptance harness: a Windows 10
 * (10240-19045) or Windows 11 (22000+) client edition (ProductType 1) whose
 * CPU is not known to lack AVX. Windows 10 below 22H2 and unreadable AVX
 * support are warnings. `windows10_22H2` is null unless Windows 10 with a
 * numeric build.
 */
export function classifyWindows({ caption, productType, build, avx }) {
    const problems = [];
    const warnings = [];
    const major = /^Microsoft Windows (10|11)\b/i.exec(caption ?? '')?.[1];
    const known = Number.isSafeInteger(build);
    if (productType !== 1 || !major)
        problems.push(
            `not a Windows 10 or Windows 11 client edition: ${caption} (product type ${productType})`,
        );
    else if (
        !known ||
        (major === '11'
            ? build < WINDOWS_11_MIN_BUILD
            : build < WINDOWS_10_MIN_BUILD || build > WINDOWS_10_22H2_BUILD)
    )
        problems.push(`build ${build}`);
    else if (major === '10' && build < WINDOWS_10_22H2_BUILD)
        warnings.push(
            `Windows 10 build ${build} is not 22H2 (${WINDOWS_10_22H2_BUILD})`,
        );
    if (avx === false) problems.push('CPU has no AVX');
    else if (avx !== true) warnings.push('CPU AVX support could not be read');
    return {
        problems,
        warnings,
        windows10_22H2:
            major === '10' && known ? build >= WINDOWS_10_22H2_BUILD : null,
    };
}

/**
 * Refuses anything but a Windows 10 or Windows 11 client edition on
 * Intel/AMD x64 (`classifyWindows`). Returns the warnings to record.
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
    const { problems, warnings, windows10_22H2 } = classifyWindows({
        caption,
        productType,
        build,
        avx,
    });
    if (
        platform !== 'win32' ||
        arch !== 'x64' ||
        !['GenuineIntel', 'AuthenticAMD'].includes(cpu)
    )
        problems.push('not Intel/AMD x64 Windows');
    if (problems.length)
        throw new Error(
            `Proof requires actual Windows 10 or Windows 11 Intel/AMD x64 workstation (${problems.join('; ')}).`,
        );
    return { windows10_22H2, warnings };
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
